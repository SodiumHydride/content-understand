"""Unified OpenAI-compatible content model.

Single ContentModel implementation that handles video, image, audio, and article
understanding for any OpenAI-compatible endpoint (Ollama, vLLM, llama.cpp, LM Studio, etc.).

Merges the logic of:
- OpenAICompatModel (video frame extraction, local vs cloud)
- OpenAICompatImageModel (vision chat with base64/URL images)
- OpenAICompatAudioModel (transcribe-then-chat with _to_wav conversion)
- OpenAICompatArticleModel (60K truncation, structured prompts)

Local vs cloud behaviour is determined by the api_base URL and can be further
tuned via the ``extra`` config dict (fps, max_frames, scale, batch_size, etc.).
"""

from __future__ import annotations

import base64
import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from content_understand._keys import KeyRotator, rotate_request
from content_understand.capabilities import (
    ContentBundle,
    Modality,
    ModelCapabilities,
)
from content_understand.models.base import ContentModel

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default prompts (identical to the legacy models)
# ---------------------------------------------------------------------------

_VIDEO_PROMPT: dict[str, str] = {
    "zh": "请详细分析这段视频的内容，包括主要场景、关键事件和重要细节。",
    "en": "Analyze this video in detail, including main scenes, key events, and important details.",
}

_IMAGE_PROMPT: dict[str, str] = {
    "zh": (
        "请详细分析这张图片，按以下结构输出：\n\n"
        "## 摘要\n描述图片的主要内容\n\n"
        "## 要点\n- 列出图片中的关键元素\n\n"
        "## 标签\n给出 5-10 个相关标签\n\n"
        "## 总结\n用 1-2 句话总结图片主旨"
    ),
    "en": (
        "Analyze this image in detail, output in the following structure:\n\n"
        "## Summary\nDescribe the main content of the image\n\n"
        "## Key Points\n- List key elements in the image\n\n"
        "## Tags\n- Give 5-10 relevant tags\n\n"
        "## Conclusion\n- Summarize the image's message in 1-2 sentences"
    ),
}

_TRANSCRIBE_PROMPT = (
    "Transcribe this audio accurately. Output only the transcript text, no commentary."
)

_AUDIO_SUMMARY: dict[str, str] = {
    "zh": (
        "请根据以下音频转录内容，按结构输出分析：\n\n"
        "## 摘要\n## 要点\n## 标签\n## 总结\n\n"
        "转录：\n{transcript}"
    ),
    "en": (
        "Based on the following audio transcript, output a structured analysis:\n\n"
        "## Summary\n## Key Points\n## Tags\n## Conclusion\n\n"
        "Transcript:\n{transcript}"
    ),
}

_ARTICLE_PROMPT: dict[str, str] = {
    "zh": (
        "请详细分析以下文章内容，输出结构化摘要。\n\n"
        "标题：{title}\n来源：{url}\n\n"
        "文章内容：\n```\n{text}\n```\n\n"
        "请按以下结构输出：\n\n"
        "## 要点\n- 列出文章的核心要点（3-8 条）\n\n"
        "## 详细内容\n- 按论点或主题分段展开说明\n\n"
        "## 标签\n- 给出 5-10 个相关标签，格式：#标签1 #标签2 ...\n\n"
        "## 总结\n- 用 2-3 句话总结文章主旨"
    ),
    "en": (
        "Analyze the following article and output a structured summary.\n\n"
        "Title: {title}\nSource: {url}\n\n"
        "Article content:\n```\n{text}\n```\n\n"
        "Output in the following structure:\n\n"
        "## Key Points\n- List core points (3-8 items)\n\n"
        "## Detailed Content\n- Expand by argument or theme\n\n"
        "## Tags\n- Give 5-10 relevant tags, format: #tag1 #tag2 ...\n\n"
        "## Conclusion\n- Summarize the article's core message in 2-3 sentences"
    ),
}

# Mime-type lookup for image encoding
_MIME_MAP: dict[str, str] = {
    "jpg": "jpeg",
    "jpeg": "jpeg",
    "png": "png",
    "gif": "gif",
    "webp": "webp",
}


class OpenAICompatUnifiedContentModel(ContentModel):
    """Unified content model for any OpenAI-compatible endpoint.

    Handles video (frame extraction), image (vision chat), audio
    (transcribe-then-chat), and article (text analysis) in one class.

    Configuration knobs (via config or config.extra):
        fps / max_frames / scale        — video frame extraction (local vs cloud)
        batch_size                      — frames per batch for local Ollama
        video_timeout / audio_timeout   — per-modality timeout overrides
        image_model / audio_model       — model name overrides per modality
        max_article_chars               — article truncation limit (default 60000)
    """

    def __init__(self, config: Any) -> None:
        self.api_base: str = config.api_base.rstrip("/")
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name: str = config.model or ""
        self.max_tokens: int = config.max_tokens or 4096
        self.timeout: int = config.timeout or 120

        # Extra tuning knobs (config.extra or config dict)
        extra: dict = getattr(config, "extra", None) or {}

        # Model name overrides per modality
        self._image_model: str = getattr(config, "image_model", None) or extra.get("image_model", self.model_name)
        self._audio_model: str = getattr(config, "audio_model", None) or extra.get("audio_model", self.model_name)

        # Local endpoint detection
        self._is_local: bool = "127.0.0.1" in self.api_base or "localhost" in self.api_base

        # Video frame extraction settings (local vs cloud defaults)
        if self._is_local:
            self._video_fps: float = extra.get("fps", 0.5)
            self._video_max_frames: int = extra.get("max_frames", 4)
            self._video_scale: str = extra.get("scale", "512:-2")
            self._video_batch_size: int = extra.get("batch_size", 2)
        else:
            self._video_fps: float = extra.get("fps", 2.0)
            self._video_max_frames: int = extra.get("max_frames", 20)
            self._video_scale: str = extra.get("scale", "")
            self._video_batch_size: int = extra.get("batch_size", 0)  # 0 = no batching

        # Timeout overrides
        self._video_timeout: int = extra.get("video_timeout", max(self.timeout, 600) if self._is_local else self.timeout)
        self._audio_timeout: int = extra.get("audio_timeout", 600)
        self._article_max_chars: int = extra.get("max_article_chars", 60000)

    # ------------------------------------------------------------------
    # Capabilities
    # ------------------------------------------------------------------

    def capabilities(self) -> ModelCapabilities:
        accepts = Modality.TEXT | Modality.IMAGE | Modality.VIDEO | Modality.AUDIO

        return ModelCapabilities(
            accepts=accepts,
            preferred_input=Modality.VIDEO,
            supports_url_input=False,
            supports_base64_input=True,
            supports_native_video=False,
            default_fps=self._video_fps,
            default_scale=self._video_scale,
            max_frames=self._video_max_frames,
        )

    # ------------------------------------------------------------------
    # Router
    # ------------------------------------------------------------------

    def understand(
        self,
        bundle: ContentBundle,
        prompt: str = "",
        timeout: int = 120,
        language: str = "zh",
        frame_config: Any | None = None,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str | dict:
        ct = bundle.content_type
        if ct == "video":
            result = self._understand_video(bundle, prompt, timeout, language, output_format, json_schema)
        elif ct == "image":
            result = self._understand_image(bundle, prompt, timeout, language, output_format, json_schema)
        elif ct == "audio":
            result = self._understand_audio(bundle, prompt, timeout, language, output_format, json_schema)
        else:
            result = self._understand_article(bundle, prompt, timeout, language, output_format, json_schema)

        if output_format == "json" and isinstance(result, str):
            try:
                return json.loads(result)
            except json.JSONDecodeError:
                return result
        return result

    # ------------------------------------------------------------------
    # Low-level API helper
    # ------------------------------------------------------------------

    def _call_api(self, body: dict, timeout: int, label: str = "openai-compat") -> str:
        return rotate_request(
            f"{self.api_base}/chat/completions",
            body,
            self.rotator,
            timeout,
            label,
        )

    def _chat(self, prompt: str, model: str, timeout: int, label: str, output_format: str = "text", json_schema: dict | None = None) -> str:
        if json_schema:
            prompt = f"{prompt}\n\nRespond strictly as JSON matching this schema:\n{json.dumps(json_schema)}"
        body: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": self.max_tokens,
        }
        if output_format == "json":
            body["response_format"] = {"type": "json_object"}
        return self._call_api(body, timeout, label)

    # ------------------------------------------------------------------
    # Video
    # ------------------------------------------------------------------

    def _extract_frames(
        self,
        video_path: str,
        fps: float,
        max_frames: int,
        scale: str = "",
    ) -> list[str]:
        """Extract video frames as base64-encoded JPEG strings via ffmpeg."""
        tmpdir = tempfile.mkdtemp(prefix="vu_frames_")
        try:
            vf = f"fps={fps}"
            if scale:
                vf = f"{vf},{scale}"
            cmd = [
                "ffmpeg", "-i", video_path,
                "-vf", vf,
                "-frames:v", str(max_frames),
                "-q:v", "5",
                f"{tmpdir}/frame_%04d.jpg",
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=120)
            if result.returncode != 0:
                logger.warning(
                    "ffmpeg frame extraction failed: %s",
                    result.stderr.decode(errors="replace")[:200],
                )
                return []

            frames: list[str] = []
            for f in sorted(Path(tmpdir).glob("frame_*.jpg")):
                frames.append(base64.b64encode(f.read_bytes()).decode())

            logger.info("Extracted %d frames at %.1f fps", len(frames), fps)
            return frames
        finally:
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)

    def _build_vision_body(self, frames_b64: list[str], prompt: str, model: str, output_format: str = "text", json_schema: dict | None = None) -> dict:
        if json_schema:
            prompt = f"{prompt}\n\nRespond strictly as JSON matching this schema:\n{json.dumps(json_schema)}"
        content: list[dict] = []
        for b64 in frames_b64:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            })
        content.append({"type": "text", "text": prompt})
        body: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": self.max_tokens,
        }
        if output_format == "json":
            body["response_format"] = {"type": "json_object"}
        return body

    def _analyze_frames(self, frames_b64: list[str], prompt: str, timeout: int, output_format: str = "text", json_schema: dict | None = None) -> str:
        body = self._build_vision_body(frames_b64, prompt, self.model_name, output_format, json_schema)
        return self._call_api(body, timeout, "openai-compat:video")

    def _video_batched(self, frames_b64: list[str], prompt: str, timeout: int, output_format: str = "text", json_schema: dict | None = None) -> str:
        """Analyze frames in small batches for local Ollama (avoids payload OOM)."""
        batch_size = self._video_batch_size or 2
        summaries: list[str] = []

        for i in range(0, len(frames_b64), batch_size):
            batch = frames_b64[i : i + batch_size]
            if i == 0:
                batch_prompt = prompt
            else:
                batch_prompt = (
                    "Continue analyzing this video. Previous segment summary:\n"
                    f"{summaries[-1][:2000]}\n\n"
                    "Analyze these additional frames and extend the analysis:"
                )
            try:
                result = self._analyze_frames(batch, batch_prompt, timeout, output_format, json_schema)
                summaries.append(result)
            except Exception as exc:
                logger.warning(
                    "Batch %d (%d frames) failed: %s -- retrying single frame",
                    i // batch_size, len(batch), exc,
                )
                if len(batch) == 1:
                    raise
                result = self._analyze_frames(batch[:1], batch_prompt, timeout, output_format, json_schema)
                summaries.append(result)

        if len(summaries) == 1:
            return summaries[0]

        merge_prompt = (
            "Synthesize these per-segment video analyses into one cohesive structured report:\n\n"
            + "\n\n---\n\n".join(summaries)
        )
        return self._chat(merge_prompt, self.model_name, timeout, "openai-compat:video:merge", output_format, json_schema)

    def _understand_video(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str:
        # Pre-extracted frames from preprocessor
        if bundle.frames:
            frames_b64: list[str] = []
            for fp in bundle.frames:
                frames_b64.append(base64.b64encode(Path(fp).read_bytes()).decode())
            return self._analyze_frames(
                frames_b64,
                prompt or _VIDEO_PROMPT.get(language, _VIDEO_PROMPT["zh"]),
                timeout or self._video_timeout,
                output_format, json_schema,
            )

        video_path = bundle.video_path
        if not video_path:
            raise ValueError("No video content in bundle")

        effective_timeout = timeout or self._video_timeout
        frames_b64 = self._extract_frames(
            video_path,
            fps=self._video_fps,
            max_frames=self._video_max_frames,
            scale=self._video_scale,
        )
        if not frames_b64:
            raise RuntimeError("Failed to extract frames from video")

        final_prompt = prompt or _VIDEO_PROMPT.get(language, _VIDEO_PROMPT["zh"])

        if self._is_local:
            logger.info(
                "Local Ollama video: %d frames, batched analysis, timeout=%ds",
                len(frames_b64), effective_timeout,
            )
            return self._video_batched(frames_b64, final_prompt, effective_timeout, output_format, json_schema)

        return self._analyze_frames(frames_b64, final_prompt, effective_timeout, output_format, json_schema)

    # ------------------------------------------------------------------
    # Image
    # ------------------------------------------------------------------

    def _understand_image(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str:
        if not bundle.images:
            raise ValueError("No images in bundle")

        content: list[dict] = []
        img_path = bundle.images[0]

        data = Path(img_path).read_bytes()
        b64 = base64.b64encode(data).decode()
        ext = Path(img_path).suffix.lower().lstrip(".")
        mime = _MIME_MAP.get(ext, "jpeg")
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/{mime};base64,{b64}"},
        })

        final_prompt = prompt or _IMAGE_PROMPT.get(language, _IMAGE_PROMPT["zh"])
        if json_schema:
            final_prompt = f"{final_prompt}\n\nRespond strictly as JSON matching this schema:\n{json.dumps(json_schema)}"
        content.append({"type": "text", "text": final_prompt})

        body: dict[str, Any] = {
            "model": self._image_model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": self.max_tokens,
        }
        if output_format == "json":
            body["response_format"] = {"type": "json_object"}
        return self._call_api(body, timeout or self.timeout, "openai-compat:image")

    # ------------------------------------------------------------------
    # Audio
    # ------------------------------------------------------------------

    def _to_wav(self, audio_path: str) -> str:
        """Convert any audio to 16kHz mono WAV for local models."""
        fd, out = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        cmd = ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", out]
        proc = subprocess.run(cmd, capture_output=True, timeout=120)
        if proc.returncode != 0:
            raise RuntimeError("ffmpeg audio conversion failed. Install ffmpeg for local audio.")
        return out

    def _transcribe_with_model(self, wav_path: str, timeout: int) -> str:
        """Try native input_audio API for transcription."""
        b64 = base64.b64encode(Path(wav_path).read_bytes()).decode()
        body: dict[str, Any] = {
            "model": self._audio_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_audio", "input_audio": {"data": b64, "format": "wav"}},
                        {"type": "text", "text": _TRANSCRIBE_PROMPT},
                    ],
                }
            ],
            "max_tokens": self.max_tokens,
        }
        return self._call_api(body, timeout, "openai-compat:audio:transcribe")

    def _transcribe_audio(self, audio_path: str, language: str, timeout: int) -> str:
        """Transcribe audio: convert to wav, try native API, fall back to text-only."""
        wav = self._to_wav(audio_path)
        try:
            try:
                return self._transcribe_with_model(wav, timeout)
            except Exception:
                logger.info("Native audio API failed, falling back to text-only transcription")
                body: dict[str, Any] = {
                    "model": self._audio_model,
                    "messages": [
                        {
                            "role": "user",
                            "content": (
                                f"{_TRANSCRIBE_PROMPT}\n"
                                f"(Audio file: {audio_path}, language hint: {language})"
                            ),
                        }
                    ],
                    "max_tokens": self.max_tokens,
                }
                return self._call_api(body, timeout, "openai-compat:audio:transcribe-fallback")
        finally:
            Path(wav).unlink(missing_ok=True)

    def _understand_audio(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str:
        if not bundle.audio_path:
            raise ValueError("No audio content in bundle")

        effective_timeout = timeout or self._audio_timeout
        transcript = self._transcribe_audio(
            bundle.audio_path, language, min(effective_timeout, 300),
        )
        if not transcript.strip():
            raise RuntimeError("Audio transcription returned empty text")

        if not prompt:
            template = _AUDIO_SUMMARY.get(language, _AUDIO_SUMMARY["zh"])
            prompt = template.format(transcript=transcript[:12000])

        return self._chat(prompt, self._audio_model, effective_timeout, "openai-compat:audio:summary", output_format, json_schema)

    # ------------------------------------------------------------------
    # Article
    # ------------------------------------------------------------------

    def _understand_article(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str:
        text = bundle.text or ""
        if len(text) > self._article_max_chars:
            text = text[: self._article_max_chars] + "\n\n[... text truncated ...]"

        if not prompt:
            template = _ARTICLE_PROMPT.get(language, _ARTICLE_PROMPT["zh"])
            prompt = template.format(
                title=bundle.metadata.get("title", ""),
                url=bundle.original_url,
                text=text,
            )

        if json_schema:
            prompt = f"{prompt}\n\nRespond strictly as JSON matching this schema:\n{json.dumps(json_schema)}"

        body: dict[str, Any] = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": self.max_tokens,
        }
        if output_format == "json":
            body["response_format"] = {"type": "json_object"}
        return self._call_api(body, timeout or self.timeout, "openai-compat:article")
