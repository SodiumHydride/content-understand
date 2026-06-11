"""MiMo unified ContentModel — single class for all modalities.

Merges the logic from four legacy backends into one ContentModel:
  - MimoModel        (video: video_url content type, mimo-v2.5)
  - MimoImageModel   (image: image_url content type, mimo-v2.5)
  - MimoAudioModel   (audio: input_audio content type, mimo-v2.5)
  - MimoArticleModel (article: text-only, mimo-v2.5-pro)

Plus the adapter pattern for video+audio combined requests.

All API call logic, prompts, headers, and payload formats are preserved
exactly as they were in the legacy files.
"""

from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

from content_understand._keys import KeyRotator, rotate_request
from content_understand.capabilities import (
    ContentBundle,
    Modality,
    ModelCapabilities,
)
from content_understand.defaults import MIMO_DEFAULT_MODEL, MIMO_DEFAULT_MODEL_PRO
from content_understand.models.base import ContentModel

if TYPE_CHECKING:
    from content_understand.preprocessing import FrameConfig

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default prompts — verbatim from legacy files
# ---------------------------------------------------------------------------

_DEFAULT_VIDEO_PROMPT: dict[str, str] = {
    "zh": (
        "请详细分析这段视频（包括画面和音频），按以下结构输出：\n\n"
        "## 摘要\n用 2-3 句话概括视频主旨\n\n"
        "## 要点\n- 列出核心要点（3-8 条）\n\n"
        "## 详细内容\n按时间线或主题分段展开\n\n"
        "## 标签\n给出 5-10 个相关标签\n\n"
        "## 总结\n用 2-3 句话总结核心价值"
    ),
    "en": (
        "Analyze this video in detail (including visual and audio content), "
        "output in the following structure:\n\n"
        "## Summary\n## Key Points\n## Detailed Content\n## Tags\n## Conclusion"
    ),
}

_DEFAULT_AUDIO_PROMPT: dict[str, str] = {
    "zh": """请详细分析这段音频，按以下结构输出：

## 时间线
- MM:SS - MM:SS  内容分段概述（按内容逻辑分段）

## 要点
- 列出音频的核心要点（3-8 条）

## 说话人分析
- 识别到的说话人（如有多个）
- 每个说话人的立场或关键观点

## 情感与氛围
- 整体情感基调
- 情感变化或转折点（如有）

## 标签
- 给出 5-10 个相关标签，格式：#标签1 #标签2 ...

## 总结
- 用 2-3 句话总结音频主旨""",
    "en": """Analyze this audio in detail, output in the following structure:

## Timeline
- MM:SS - MM:SS  Segment overview

## Key Points
- List core points (3-8 items)

## Speaker Analysis
- Identified speakers (if multiple)
- Each speaker's stance or key viewpoints

## Emotion & Atmosphere
- Overall emotional tone
- Emotional shifts or turning points (if any)

## Tags
- Give 5-10 relevant tags, format: #tag1 #tag2 ...

## Conclusion
- Summarize the audio's core message in 2-3 sentences""",
}

_DEFAULT_ARTICLE_PROMPT: dict[str, str] = {
    "zh": """请详细分析以下文章内容，输出结构化摘要。

标题：{title}
来源：{url}

文章内容：
```
{text}
```

请按以下结构输出：

## 要点
- 列出文章的核心要点（3-8 条）

## 详细内容
- 按论点或主题分段展开说明
- 每段的核心观点和支撑论据

## 关键数据与引用
- 文中提到的关键数据、统计、引用（如有）

## 作者立场
- 作者的主要观点或立场
- 论证逻辑

## 标签
- 给出 5-10 个相关标签，格式：#标签1 #标签2 ...

## 总结
- 用 2-3 句话总结文章主旨和核心价值""",
    "en": """Analyze the following article and output a structured summary.

Title: {title}
Source: {url}

Article content:
```
{text}
```

Output in the following structure:

## Key Points
- List core points (3-8 items)

## Detailed Content
- Expand by argument or theme
- Core viewpoints and supporting evidence per section

## Key Data & Quotes
- Key data, statistics, quotes from the text (if any)

## Author's Stance
- Author's main viewpoint or position
- Argumentation logic

## Tags
- Give 5-10 relevant tags, format: #tag1 #tag2 ...

## Conclusion
- Summarize the article's core message and value in 2-3 sentences""",
}

_DEFAULT_IMAGE_PROMPT: dict[str, str] = {
    "zh": "请详细描述这张图片的内容，包括主要元素、场景、文字、风格等。给出 5-10 个相关标签，格式：#标签1 #标签2 ...",
    "en": "Describe this image in detail, including main elements, scene, text, style, etc. Give 5-10 relevant tags, format: #tag1 #tag2 ...",
}

_DEFAULT_TRANSCRIBE_PROMPT = (
    "请将这段音频转录为文字。只输出转录文本，不要添加任何分析或总结。"
)

# Article text truncation limit (from MimoArticleModel)
_ARTICLE_MAX_CHARS = 60000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mimo_headers(key: str) -> dict[str, str]:
    """MiMo uses 'api-key' header instead of 'Authorization: Bearer'."""
    return {"api-key": key, "Content-Type": "application/json"}


def _guess_mime(path: str, default: str = "application/octet-stream") -> str:
    from content_understand._mime import guess_mime

    return guess_mime(path, default=default)


def _encode_file_base64(path: str, default_mime: str) -> str:
    """Read a local file and return a data-URI string."""
    mime = _guess_mime(path, default=default_mime)
    raw = Path(path).read_bytes()
    b64 = base64.b64encode(raw).decode()
    return f"data:{mime};base64,{b64}"


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------

class MimoUnifiedContentModel(ContentModel):
    """Unified MiMo backend — understands video, image, audio, and text.

    All API call logic is self-contained (no wrapper around legacy classes).
    A single KeyRotator is shared across all modalities.
    """

    def __init__(self, config: Any) -> None:
        self.api_base: str = config.api_base
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_video: str = getattr(config, "model", None) or MIMO_DEFAULT_MODEL
        self.model_image: str = getattr(config, "image_model", None) or MIMO_DEFAULT_MODEL
        self.model_audio: str = getattr(config, "model", None) or MIMO_DEFAULT_MODEL
        self.model_text: str = getattr(config, "model", None) or MIMO_DEFAULT_MODEL_PRO
        self.max_tokens: int = config.max_tokens
        self.timeout: int = config.timeout or 120

        extra = getattr(config, "extra", {}) or {}
        self.force_base64: bool = extra.get("force_base64", False)

    # ── ContentModel interface ──────────────────────────────────────────

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            accepts=Modality.OMNI,
            preferred_input=Modality.VIDEO_WITH_AUDIO,
            supports_url_input=True,
            supports_base64_input=True,
            supports_native_video=True,
            default_fps=2.0,
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
        timeout = timeout or self.timeout

        if bundle.content_type == "video":
            result = self._understand_video(
                bundle, prompt, timeout, language, frame_config,
                output_format, json_schema,
            )
        elif bundle.content_type == "image":
            result = self._understand_image(
                bundle, prompt, timeout, language, output_format, json_schema,
            )
        elif bundle.content_type == "audio":
            result = self._understand_audio(
                bundle, prompt, timeout, language, output_format, json_schema,
            )
        elif bundle.content_type == "article":
            result = self._understand_article(
                bundle, prompt, timeout, language, output_format, json_schema,
            )
        else:
            # Text-only fallback
            result = self._understand_text(prompt, timeout)

        # Parse JSON if structured output was requested
        if output_format == "json" and isinstance(result, str):
            import json

            try:
                return json.loads(result)
            except json.JSONDecodeError:
                return result

        return result

    # ── Video ───────────────────────────────────────────────────────────

    def _understand_video(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        frame_config: FrameConfig | None = None,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str:
        """Video understanding with optional simultaneous audio.

        Exact payload format from MimoModel + MimoAdapter:
          - video_url content type with fps and media_resolution
          - optional input_audio content for separated audio
        """
        fps = frame_config.fps if frame_config else 2.0

        if json_schema:
            import json
            prompt += f"\n\nRespond strictly as JSON matching this schema:\n{json.dumps(json_schema, ensure_ascii=False)}"

        # Resolve video URL — prefer original URL, then pre-encoded base64, then local file
        video_url: str | None = None
        if bundle.original_url and bundle.original_url.startswith("http"):
            video_url = bundle.original_url
        elif bundle.video_base64:
            video_url = f"data:video/mp4;base64,{bundle.video_base64}"
        elif bundle.video_path:
            video_url = _encode_file_base64(bundle.video_path, "video/mp4")

        if not video_url:
            raise RuntimeError("No video content available in bundle")

        # Build content list
        content: list[dict[str, Any]] = [
            {
                "type": "video_url",
                "video_url": {"url": video_url},
                "fps": fps,
                "media_resolution": "default",
            }
        ]

        # Add separated audio if available (adapter pattern)
        if bundle.audio_path and bundle.audio_path != bundle.video_path:
            audio_b64 = _encode_file_base64(bundle.audio_path, "audio/mpeg")
            content.append({"type": "input_audio", "input_audio": {"data": audio_b64}})

        content.append({"type": "text", "text": prompt or _DEFAULT_VIDEO_PROMPT.get(language, _DEFAULT_VIDEO_PROMPT["zh"])})

        body: dict[str, Any] = {
            "model": self.model_video,
            "messages": [{"role": "user", "content": content}],
            "max_completion_tokens": self.max_tokens,
        }

        if output_format == "json":
            body["response_format"] = {"type": "json_object"}
            body["temperature"] = 0.1

        return self._post(body, timeout, "video")

    # ── Image ───────────────────────────────────────────────────────────

    def _understand_image(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str:
        """Image understanding via image_url content type.

        Exact payload format from MimoImageModel.
        """
        if not prompt:
            prompt = _DEFAULT_IMAGE_PROMPT.get(language, _DEFAULT_IMAGE_PROMPT["en"])

        if json_schema:
            import json
            prompt += f"\n\nRespond strictly as JSON matching this schema:\n{json.dumps(json_schema, ensure_ascii=False)}"

        image_url = self._resolve_image_url(bundle)
        if not image_url:
            raise ValueError("No image content available in bundle")

        body: dict[str, Any] = {
            "model": self.model_image,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": image_url}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            "max_completion_tokens": self.max_tokens,
        }

        if output_format == "json":
            body["response_format"] = {"type": "json_object"}
            body["temperature"] = 0.1

        return self._post(body, timeout, "image")

    # ── Audio ───────────────────────────────────────────────────────────

    def _understand_audio(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str:
        """Audio understanding via input_audio content type.

        Exact payload format from MimoAudioModel.
        """
        if not prompt:
            prompt = _DEFAULT_AUDIO_PROMPT.get(language, _DEFAULT_AUDIO_PROMPT["zh"])

        if json_schema:
            import json
            prompt += f"\n\nRespond strictly as JSON matching this schema:\n{json.dumps(json_schema, ensure_ascii=False)}"

        audio_data = self._resolve_audio_data(bundle)

        body: dict[str, Any] = {
            "model": self.model_audio,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_audio", "input_audio": {"data": audio_data}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            "max_completion_tokens": self.max_tokens,
        }

        if output_format == "json":
            body["response_format"] = {"type": "json_object"}
            body["temperature"] = 0.1

        return self._post(body, timeout, "audio")

    def transcribe_audio(
        self,
        bundle: ContentBundle,
        timeout: int = 600,
        language: str = "zh",
    ) -> str:
        """Transcribe audio to text without analysis.

        Exact payload format from MimoAudioModel.transcribe_audio.
        """
        audio_data = self._resolve_audio_data(bundle)

        body: dict[str, Any] = {
            "model": self.model_audio,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_audio", "input_audio": {"data": audio_data}},
                        {"type": "text", "text": _DEFAULT_TRANSCRIBE_PROMPT},
                    ],
                }
            ],
            "max_completion_tokens": self.max_tokens,
        }

        return self._post(body, timeout, "transcribe")

    # ── Article ─────────────────────────────────────────────────────────

    def _understand_article(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str,
        output_format: str = "text",
        json_schema: dict | None = None,
    ) -> str:
        """Article understanding via text-only API.

        Exact payload format from MimoArticleModel:
          - uses mimo-v2.5-pro (text model)
          - 60K char truncation
          - templated prompt with title/url/text
        """
        text = bundle.text or ""

        if len(text) > _ARTICLE_MAX_CHARS:
            text = text[:_ARTICLE_MAX_CHARS] + "\n\n[... text truncated ...]"

        if not prompt:
            template = _DEFAULT_ARTICLE_PROMPT.get(language, _DEFAULT_ARTICLE_PROMPT["zh"])
            title = bundle.metadata.get("title", "")
            url = bundle.metadata.get("url", bundle.original_url)
            prompt = template.format(title=title, url=url, text=text)

        if json_schema:
            import json
            prompt += f"\n\nRespond strictly as JSON matching this schema:\n{json.dumps(json_schema, ensure_ascii=False)}"

        body: dict[str, Any] = {
            "model": self.model_text,
            "messages": [{"role": "user", "content": prompt}],
            "max_completion_tokens": self.max_tokens,
        }

        if output_format == "json":
            body["response_format"] = {"type": "json_object"}
            body["temperature"] = 0.1

        return self._post(body, timeout, "article")

    # ── Text-only fallback ──────────────────────────────────────────────

    def _understand_text(self, prompt: str, timeout: int) -> str:
        """Plain text understanding — no media content."""
        body: dict[str, Any] = {
            "model": self.model_text,
            "messages": [{"role": "user", "content": prompt}],
            "max_completion_tokens": self.max_tokens,
        }

        return self._post(body, timeout, "text")

    # ── Internal helpers ────────────────────────────────────────────────

    def _post(self, body: dict, timeout: int, label: str) -> str:
        """Shared POST with multi-key rotation."""
        return rotate_request(
            self.api_base,
            body,
            self.rotator,
            timeout,
            f"mimo:{label}",
            headers_factory=_mimo_headers,
        )

    def _resolve_image_url(self, bundle: ContentBundle) -> str | None:
        """Resolve the best available image URL from a bundle."""
        if bundle.original_url and bundle.original_url.startswith("http"):
            return bundle.original_url
        if bundle.images:
            return _encode_file_base64(str(bundle.images[0]), "image/jpeg")
        if bundle.local_path:
            return _encode_file_base64(bundle.local_path, "image/jpeg")
        return None

    def _resolve_audio_data(self, bundle: ContentBundle) -> str:
        """Resolve audio data — base64 data-URI or raw URL.

        Mirrors MimoAudioModel: force_base64 config forces local encoding
        even for HTTP URLs.
        """
        audio_path = bundle.audio_path
        if not audio_path:
            raise ValueError("No audio content available in bundle")

        if self.force_base64 or not audio_path.startswith("http"):
            return _encode_file_base64(audio_path, "audio/mpeg")
        return audio_path
