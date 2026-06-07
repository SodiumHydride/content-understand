"""Gemma 4 12B backend — encoder-free omni model via Ollama.

Gemma 4 12B natively ingests text, images, audio, and video through a single
decoder-only transformer. Ollama supports this via the `images` array, which
accepts both image data (JPEG/PNG) and audio data (WAV).

Video processing strategy:
- Split video into 30s segments (Gemma4 audio limit = 30s)
- Each segment: extract frames (1fps JPEG) + audio (WAV 16kHz mono)
- Pass all as base64 in the `images` array — Ollama handles the rest
- Batch processing with controlled concurrency (3 at a time)
- Merge segment results structurally (no re-summarization)
"""

from __future__ import annotations

import base64
import json
import logging
import os
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from content_understand.capabilities import (
    ContentBundle,
    Modality,
    ModelCapabilities,
)
from content_understand.models.base import ContentModel
from content_understand.preprocessing import FrameConfig

logger = logging.getLogger(__name__)

_OLLAMA_CHAT = "/api/chat"

# Gemma 4 hard limits
_SEGMENT_SECONDS = 30
_MAX_CONCURRENT = 3
_DEFAULT_NUM_CTX = 16384
_DEFAULT_FPS = 1 / 3  # 1 frame per 3 seconds — 10 frames per 30s segment
_DEFAULT_MAX_CONCURRENT = 1  # Safe default — Ollama on most machines can't handle >1


def _get_duration(path: str) -> float | None:
    try:
        cmd = [
            "ffprobe", "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception as e:
        logger.debug("ffprobe duration error: %s", e)
    return None


def _split_video(video_path: str, segment_sec: int = _SEGMENT_SECONDS) -> list[dict]:
    """Split video into segments using FFmpeg stream copy (fast, no re-encode)."""
    duration = _get_duration(video_path)
    if duration is None:
        return [{"path": video_path, "start": 0.0, "end": 0.0, "index": 0}]

    if duration <= segment_sec + 2:
        return [{"path": video_path, "start": 0.0, "end": duration, "index": 0}]

    tmpdir = tempfile.mkdtemp(prefix="cu_seg_")
    segments = []
    idx = 0
    start = 0.0

    while start < duration:
        end = min(start + segment_sec, duration)
        seg_path = os.path.join(tmpdir, f"seg_{idx:04d}.mp4")

        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-ss", str(start),
            "-t", str(end - start),
            "-c", "copy",
            "-avoid_negative_ts", "make_zero",
            seg_path,
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, timeout=60)
            if result.returncode == 0 and os.path.exists(seg_path):
                segments.append({"path": seg_path, "start": start, "end": end, "index": idx})
            else:
                logger.warning("Segment %d split failed: %s", idx,
                               result.stderr.decode(errors="replace")[:200])
        except Exception as e:
            logger.warning("Segment %d split error: %s", idx, e)

        start = end
        idx += 1

    logger.info("Split %s (%.0fs) into %d segments", video_path, duration, len(segments))
    return segments


def _extract_segment_materials(seg_path: str, tmpdir: str) -> tuple[list[str], str | None]:
    """Extract frames (JPEG base64) and audio (WAV base64) from a video segment.

    Returns (frame_base64_list, audio_base64_or_none).
    """
    frames_dir = os.path.join(tmpdir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    # Extract frames at 1/3fps (10 frames per 30s segment)
    frame_cmd = [
        "ffmpeg", "-y",
        "-i", seg_path,
        "-vf", f"fps={_DEFAULT_FPS}",
        "-q:v", "5",
        os.path.join(frames_dir, "f_%04d.jpg"),
    ]

    frames_b64 = []
    try:
        subprocess.run(frame_cmd, capture_output=True, timeout=60)
        for f in sorted(Path(frames_dir).glob("f_*.jpg")):
            b64 = base64.b64encode(f.read_bytes()).decode()
            frames_b64.append(b64)
            f.unlink()
    except Exception as e:
        logger.warning("Frame extraction failed: %s", e)

    # Extract audio as WAV (16kHz mono)
    audio_path = os.path.join(tmpdir, "audio.wav")
    audio_cmd = [
        "ffmpeg", "-y",
        "-i", seg_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        audio_path,
    ]

    audio_b64 = None
    try:
        result = subprocess.run(audio_cmd, capture_output=True, timeout=60)
        if result.returncode == 0 and os.path.exists(audio_path):
            audio_b64 = base64.b64encode(Path(audio_path).read_bytes()).decode()
            os.unlink(audio_path)
    except Exception as e:
        logger.warning("Audio extraction failed: %s", e)

    return frames_b64, audio_b64


def _cleanup_segments(segments: list[dict]) -> None:
    for seg in segments:
        p = Path(seg["path"])
        if p.exists() and "cu_seg_" in str(p):
            try:
                p.unlink()
            except OSError:
                pass
            try:
                parent = p.parent
                if parent.exists() and not any(parent.iterdir()):
                    parent.rmdir()
            except OSError:
                pass


def _mmss(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m:02d}:{s:02d}"


# ── Prompts ──────────────────────────────────────────────────────

_SEGMENT_PROMPT_ZH = (
    "请分析这段视频片段（{start}-{end}），同时观看画面和聆听音频。"
    "严格按以下 JSON 格式输出，不要输出其他内容：\n"
    "{{\n"
    '  "timeline": "对这段视频内容的时间线描述（包含画面和语音信息）",\n'
    '  "key_points": ["要点1", "要点2", "要点3"],\n'
    '  "tags": ["标签1", "标签2", "标签3"]\n'
    "}}"
)

_SEGMENT_PROMPT_EN = (
    "Analyze this video segment ({start}-{end}), watching the visuals and listening to the audio. "
    "Output strict JSON only:\n"
    "{{\n"
    '  "timeline": "timeline description of this segment (include visual and audio info)",\n'
    '  "key_points": ["point1", "point2", "point3"],\n'
    '  "tags": ["tag1", "tag2", "tag3"]\n'
    "}}"
)

_WIKI_SUMMARY_PROMPT_ZH = """你是知识库写手。根据以下视频分段分析结果，生成一篇完整的 wiki 页面。

视频标题：{title}
视频来源：{url}
视频时长：{duration}

分段分析结果：
{segments_json}

请按以下格式输出（不要输出 JSON，直接输出 Markdown）：

# {title}

## 时间线

按时间顺序列出每个时间段的核心内容，每条格式：
- **MM:SS - MM:SS**：详细描述（包含画面内容和语音信息）

## 要点

列出视频的核心要点（5-15 条），每条要有实质内容，不要泛泛而谈。

## 详细内容

按时间线或主题展开详细叙述。这不是简单的段落拼接，而是连贯的文章。要：
- 把各段信息串联成流畅的叙述
- 包含具体的数据、人名、概念
- 引用视频中的关键原话或观点

## 标签

给出 8-15 个相关标签，格式：#标签1 #标签2 ...
"""

_WIKI_SUMMARY_PROMPT_EN = """You are a knowledge base writer. Based on the following video segment analyses, generate a complete wiki page.

Video title: {title}
Video source: {url}
Video duration: {duration}

Segment analyses:
{segments_json}

Output in the following format (Markdown, not JSON):

# {title}

## Timeline

List each time segment's core content chronologically:
- **MM:SS - MM:SS**: Detailed description (including visual and audio information)

## Key Points

List core points of the video (5-15 items), each with substantial content.

## Detailed Content

Expand by timeline or theme into a coherent narrative. This is NOT simple segment concatenation — it should be a flowing article that:
- Connects information across segments into coherent prose
- Includes specific data, names, concepts
- References key quotes or观点 from the video

## Tags

Give 8-15 relevant tags, format: #tag1 #tag2 ...
"""


class Gemma4Model(ContentModel):
    """Gemma 4 12B — encoder-free omni model via Ollama.

    Video: split → frames+audio per segment → batch → merge.
    Image/Audio/Text: direct pass.
    """

    def __init__(self, config: Any) -> None:
        # Strip /v1 suffix if present — Gemma4 uses Ollama native API (/api/chat),
        # not the OpenAI-compatible API (/v1/chat/completions).
        base = config.api_base.rstrip("/")
        if base.endswith("/v1"):
            base = base[:-3]
        self.api_base = base
        self.model_name = config.model or "gemma4:12b-it-qat"
        self.max_tokens = config.max_tokens or 8192
        self.timeout = config.timeout or 600
        extra = getattr(config, "extra", {}) or {}
        self.segment_seconds = extra.get("segment_seconds", _SEGMENT_SECONDS)
        self.max_concurrent = extra.get("max_concurrent", _DEFAULT_MAX_CONCURRENT)
        self.num_ctx = extra.get("num_ctx", _DEFAULT_NUM_CTX)

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            accepts=(
                Modality.TEXT
                | Modality.IMAGE
                | Modality.AUDIO
                | Modality.VIDEO
                | Modality.VIDEO_WITH_AUDIO
            ),
            preferred_input=Modality.VIDEO_WITH_AUDIO,
            supports_url_input=False,
            supports_base64_input=True,
            supports_native_video=True,
            default_fps=1.0,
            default_scale="",
        )

    def understand(
        self,
        bundle: ContentBundle,
        prompt: str = "",
        timeout: int = 120,
        language: str = "zh",
        frame_config: FrameConfig | None = None,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        if bundle.content_type == "video":
            return self._understand_video(bundle, prompt, timeout, language, output_format, json_schema)
        elif bundle.content_type == "audio":
            return self._understand_audio(bundle, prompt, timeout, language, output_format, json_schema)
        elif bundle.content_type == "image":
            return self._understand_image(bundle, prompt, timeout, language, output_format, json_schema)
        else:
            return self._understand_text(bundle, prompt, timeout, language, output_format, json_schema)

    # ── Video: split → batch → merge ─────────────────────────────

    def _understand_video(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        video_path = bundle.video_path or bundle.local_path
        if not video_path or not os.path.exists(video_path):
            raise FileNotFoundError(f"Video not found: {video_path}")

        duration = _get_duration(video_path) or 0
        lang = language or "zh"

        # Short video — single pass
        if duration <= self.segment_seconds + 2:
            logger.info("Short video (%.0fs), single pass", duration)
            return self._understand_single_segment(
                video_path, prompt, timeout, lang, output_format, json_schema,
                time_range=f"00:00-{_mmss(duration)}",
            )

        # Long video — split → batch → global summarize
        logger.info("Long video (%.0fs), splitting into %ds segments", duration, self.segment_seconds)
        segments = _split_video(video_path, self.segment_seconds)
        if not segments:
            raise RuntimeError("Failed to split video")

        metadata = {
            "title": bundle.metadata.get("title", ""),
            "url": bundle.original_url or "",
            "duration": f"{int(duration)}s",
        }

        try:
            return self._understand_segmented_video(
                segments, prompt, timeout, lang, output_format, json_schema,
                metadata=metadata,
            )
        finally:
            _cleanup_segments(segments)

    def _understand_single_segment(
        self,
        video_path: str,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
        time_range: str = "",
    ) -> str | dict:
        """Process a single video segment: extract frames+audio, send to Gemma4."""
        tmpdir = tempfile.mkdtemp(prefix="cu_mat_")
        try:
            frames_b64, audio_b64 = _extract_segment_materials(video_path, tmpdir)

            content: list[dict[str, Any]] = []

            # Add frames as images (Ollama images array format)
            for b64 in frames_b64:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                })

            # Add audio if available (Ollama accepts WAV in images array)
            if audio_b64:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:audio/wav;base64,{audio_b64}"},
                })

            # Prompt
            effective_prompt = prompt or self._build_segment_prompt(time_range, language)
            content.append({"type": "text", "text": effective_prompt})

            return self._chat(content, timeout, output_format, json_schema)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def _understand_segmented_video(
        self,
        segments: list[dict],
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
        metadata: dict | None = None,
    ) -> str | dict:
        """Process video segments in batches, then global summarize into wiki format."""
        n = len(segments)
        logger.info("Processing %d segments (batch size=%d)", n, self.max_concurrent)

        segment_results: list[dict | None] = [None] * n

        def process_segment(seg: dict) -> tuple[int, dict | None]:
            idx = seg["index"]
            time_range = f"{_mmss(seg['start'])}-{_mmss(seg['end'])}"
            try:
                result = self._understand_single_segment(
                    seg["path"], prompt, timeout, language,
                    output_format="json", json_schema=None,
                    time_range=time_range,
                )
                if isinstance(result, str):
                    try:
                        result = json.loads(result)
                    except json.JSONDecodeError:
                        result = {"timeline": result, "key_points": [], "tags": []}
                result["_time_range"] = time_range
                result["_index"] = idx
                return idx, result
            except Exception as e:
                logger.warning("Segment %d (%s) failed: %s", idx, time_range, e)
                return idx, None

        with ThreadPoolExecutor(max_workers=self.max_concurrent) as executor:
            futures = {
                executor.submit(process_segment, seg): seg
                for seg in segments
            }
            for future in as_completed(futures):
                idx, result = future.result()
                segment_results[idx] = result
                done = sum(1 for r in segment_results if r is not None)
                logger.info("Segment progress: %d/%d", done, n)

        valid = [r for r in segment_results if r is not None]
        if not valid:
            return {"summary": "视频理解失败：所有片段均未返回结果。", "tags": []}

        # Global summarize → wiki format
        meta = metadata or {}
        return self._global_summarize(valid, language, meta)

    def _global_summarize(self, results: list[dict], language: str, metadata: dict) -> dict:
        """Global summarize: merge segment results → LLM → wiki-format output.

        Takes all segment JSON results, feeds them to the model in one call,
        and produces a coherent wiki page with timeline, key points,
        detailed content, and tags.
        """
        # Collect tags from all segments
        all_tags = []
        for r in results:
            all_tags.extend(r.get("tags", []))
        seen_tags = set()
        unique_tags = []
        for t in all_tags:
            key = t.strip().lower().lstrip("#")
            if key and key not in seen_tags:
                seen_tags.add(key)
                unique_tags.append(key)

        # Build segments context for the summary prompt
        segments_json = json.dumps(
            [{"time_range": r.get("_time_range", ""), "timeline": r.get("timeline", ""),
              "key_points": r.get("key_points", [])} for r in results],
            ensure_ascii=False, indent=2,
        )

        title = metadata.get("title", "Untitled")
        url = metadata.get("url", "")
        duration = metadata.get("duration", "")

        # Pick prompt based on language
        if language == "en":
            prompt = _WIKI_SUMMARY_PROMPT_EN.format(
                title=title, url=url, duration=duration, segments_json=segments_json,
            )
        else:
            prompt = _WIKI_SUMMARY_PROMPT_ZH.format(
                title=title, url=url, duration=duration, segments_json=segments_json,
            )

        logger.info("Global summarize: %d segments → wiki page", len(results))

        # Single LLM call for the full wiki page
        content = [{"type": "text", "text": prompt}]
        wiki_body = self._chat(content, self.timeout, "text", None)

        return {
            "summary": wiki_body,
            "tags": unique_tags[:15],
        }

    # ── Other modalities ─────────────────────────────────────────

    def _understand_audio(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        audio_path = bundle.audio_path
        if not audio_path or not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio not found: {audio_path}")

        duration = _get_duration(audio_path) or 0

        # Short audio — single pass
        if duration <= self.segment_seconds + 2:
            return self._understand_single_audio(
                audio_path, prompt, timeout, language, output_format, json_schema,
            )

        # Long audio — split and process
        segments = _split_video(audio_path, self.segment_seconds)
        if not segments:
            raise RuntimeError("Failed to split audio")

        try:
            results = []
            for seg in segments:
                try:
                    r = self._understand_single_audio(
                        seg["path"], prompt, timeout, language, "text", None,
                    )
                    results.append(r)
                except Exception as e:
                    logger.warning("Audio segment %d failed: %s", seg["index"], e)

            if not results:
                return {"summary": "音频理解失败。", "tags": []}

            merged = "\n\n".join(str(r) for r in results if r)
            return {"summary": merged, "tags": []}
        finally:
            _cleanup_segments(segments)

    def _understand_single_audio(
        self,
        audio_path: str,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        # Convert to WAV 16kHz mono for Ollama
        tmpdir = tempfile.mkdtemp(prefix="cu_audio_")
        wav_path = os.path.join(tmpdir, "audio.wav")
        try:
            cmd = [
                "ffmpeg", "-y",
                "-i", audio_path,
                "-vn", "-acodec", "pcm_s16le",
                "-ar", "16000", "-ac", "1",
                wav_path,
            ]
            subprocess.run(cmd, capture_output=True, timeout=60)

            audio_b64 = base64.b64encode(Path(wav_path).read_bytes()).decode()

            content: list[dict[str, Any]] = [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:audio/wav;base64,{audio_b64}"},
                },
                {"type": "text", "text": prompt or self._build_default_prompt("audio", language)},
            ]

            return self._chat(content, timeout, output_format, json_schema)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def _understand_image(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        content: list[dict[str, Any]] = []

        for img_path in bundle.images:
            b64 = base64.b64encode(Path(img_path).read_bytes()).decode()
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            })

        content.append({"type": "text", "text": prompt or self._build_default_prompt("image", language)})
        return self._chat(content, timeout, output_format, json_schema)

    def _understand_text(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        text = bundle.text or ""
        effective_prompt = prompt or self._build_default_prompt("article", language)
        if text:
            effective_prompt = f"{effective_prompt}\n\nContent:\n{text[:60000]}"

        content = [{"type": "text", "text": effective_prompt}]
        return self._chat(content, timeout, output_format, json_schema)

    # ── Chat API ─────────────────────────────────────────────────

    def _chat(self, content: list[dict], timeout: int, output_format: str = "text", json_schema: dict | None = None) -> str | dict:
        import requests

        url = f"{self.api_base}{_OLLAMA_CHAT}"

        # Ollama native API format: messages with images array
        # For multimodal content, images/audio go in the message's images field
        images = []
        text_parts = []

        for item in content:
            if item.get("type") == "image_url":
                url_data = item["image_url"]["url"]
                # Extract base64 data from data URI
                if url_data.startswith("data:"):
                    b64 = url_data.split(",", 1)[1] if "," in url_data else url_data
                else:
                    b64 = url_data
                images.append(b64)
            elif item.get("type") == "text":
                text_parts.append(item["text"])

        message: dict[str, Any] = {
            "role": "user",
            "content": "\n".join(text_parts),
        }
        if images:
            message["images"] = images

        body: dict[str, Any] = {
            "model": self.model_name,
            "messages": [message],
            "stream": False,
        }

        # Options
        body["options"] = {"num_ctx": self.num_ctx}

        # Structured output
        if output_format == "json":
            if json_schema:
                body["format"] = {"type": "json_schema", "schema": json_schema}
            else:
                body["format"] = "json"
            body["options"]["temperature"] = 0.1

        try:
            resp = requests.post(url, json=body, timeout=timeout)
            resp.raise_for_status()
            data = resp.json()
            msg = data["message"]
            result = msg.get("content", "")

            if output_format == "json":
                try:
                    return json.loads(result)
                except json.JSONDecodeError:
                    return result

            return result
        except Exception as e:
            logger.error("Gemma 4 API error: %s", e)
            raise

    # ── Prompts ──────────────────────────────────────────────────

    def _build_segment_prompt(self, time_range: str, language: str) -> str:
        parts = time_range.split("-")
        start = parts[0] if len(parts) > 0 else "00:00"
        end = parts[1] if len(parts) > 1 else "00:30"
        if language == "en":
            return _SEGMENT_PROMPT_EN.format(start=start, end=end)
        return _SEGMENT_PROMPT_ZH.format(start=start, end=end)

    def _build_default_prompt(self, content_type: str, language: str) -> str:
        defaults = {
            "video": {
                "zh": "请详细分析这段视频（包括画面和音频）。",
                "en": "Analyze this video in detail (including visual and audio content).",
            },
            "audio": {
                "zh": "请详细分析这段音频内容，包括说话人、关键信息和情感。",
                "en": "Analyze this audio in detail, including speakers, key information, and emotions.",
            },
            "image": {
                "zh": "请详细分析这张图片的内容。",
                "en": "Analyze this image in detail.",
            },
            "article": {
                "zh": "请分析以下文章内容，提取要点和标签。",
                "en": "Analyze the following article, extract key points and tags.",
            },
        }
        lang = language or "zh"
        return defaults.get(content_type, {}).get(lang, defaults.get(content_type, {}).get("zh", ""))
