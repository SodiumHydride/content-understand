"""ContentPipeline — unified entry point for multimodal content understanding.

Orchestrates: resolve → extract/understand → return structured result.
"""

from __future__ import annotations

import logging
import mimetypes
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

from content_understand.config import ContentConfig
from content_understand.models.registry import (
    create_article_model,
    create_audio_model,
    create_content_model,
    create_image_model,
    create_video_model,
    has_content_model,
)
from content_understand.preprocessing import ContentPreprocessor, FrameConfig
from content_understand.resolvers.base import ResolveResult
from content_understand.resolvers.chain import ResolverChain
from content_understand.resolvers.direct_url import DirectURLResolver
from content_understand.resolvers.http_page import HttpPageResolver
from content_understand.resolvers.local_file import LocalFileResolver
from content_understand.resolvers.search_engine import SearchEngineResolver
from content_understand.schemas import build_structured_prompt, get_schema_for_type
from content_understand.validation import validate_or_fallback

logger = logging.getLogger(__name__)

ProgressFn = Callable[[str, int, str], None]

_DEFAULT_PROMPTS: dict[str, dict[str, str]] = {
    "video": {
        "zh": (
            "请详细分析这段视频，按以下结构输出：\n\n"
            "## 摘要\n用 2-3 句话概括视频主旨\n\n"
            "## 要点\n- 列出核心要点（3-8 条）\n\n"
            "## 详细内容\n按时间线或主题分段展开\n\n"
            "## 标签\n给出 5-10 个相关标签，格式：#标签1 #标签2 ...\n\n"
            "## 总结\n用 2-3 句话总结核心价值"
        ),
        "en": (
            "Analyze this video in detail, output in the following structure:\n\n"
            "## Summary\nSummarize the main point in 2-3 sentences\n\n"
            "## Key Points\n- List core points (3-8 items)\n\n"
            "## Detailed Content\nExpand by timeline or theme\n\n"
            "## Tags\nGive 5-10 relevant tags, format: #tag1 #tag2 ...\n\n"
            "## Conclusion\nSummarize core value in 2-3 sentences"
        ),
    },
    "image": {
        "zh": (
            "请详细分析这张图片，按以下结构输出：\n\n"
            "## 摘要\n描述图片的主要内容\n\n"
            "## 要点\n- 列出图片中的关键元素\n\n"
            "## 标签\n给出 5-10 个相关标签，格式：#标签1 #标签2 ...\n\n"
            "## 总结\n用 1-2 句话总结图片主旨"
        ),
        "en": (
            "Analyze this image in detail, output in the following structure:\n\n"
            "## Summary\nDescribe the main content of the image\n\n"
            "## Key Points\n- List key elements in the image\n\n"
            "## Tags\nGive 5-10 relevant tags, format: #tag1 #tag2 ...\n\n"
            "## Conclusion\nSummarize the image's message in 1-2 sentences"
        ),
    },
    "audio": {
        "zh": (
            "请详细分析这段音频，按以下结构输出：\n\n"
            "## 时间线\n- MM:SS - MM:SS  内容分段概述\n\n"
            "## 要点\n- 列出核心要点（3-8 条）\n\n"
            "## 说话人分析\n- 识别到的说话人及关键观点\n\n"
            "## 情感与氛围\n- 整体情感基调\n\n"
            "## 标签\n给出 5-10 个相关标签，格式：#标签1 #标签2 ...\n\n"
            "## 总结\n用 2-3 句话总结音频主旨"
        ),
        "en": (
            "Analyze this audio in detail, output in the following structure:\n\n"
            "## Timeline\n- MM:SS - MM:SS  Segment overview\n\n"
            "## Key Points\n- List core points (3-8 items)\n\n"
            "## Speaker Analysis\n- Identified speakers and their key viewpoints\n\n"
            "## Emotion & Atmosphere\n- Overall emotional tone\n\n"
            "## Tags\nGive 5-10 relevant tags, format: #tag1 #tag2 ...\n\n"
            "## Conclusion\nSummarize the audio's core message in 2-3 sentences"
        ),
    },
    "article": {
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
    },
}


def _detect_content_type(path: str) -> str:
    """Detect content type from file path using MIME type."""
    mime, _ = mimetypes.guess_type(path)
    if not mime:
        ext = Path(path).suffix.lower()
        _EXTRA = {
            ".webp": "image/webp",
            ".avif": "image/avif",
            ".heic": "image/heic",
            ".opus": "audio/opus",
            ".m4b": "audio/mp4",
            ".mkv": "video/x-matroska",
            ".webm": "video/webm",
        }
        mime = _EXTRA.get(ext)

    if not mime:
        return "article"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("audio/"):
        return "audio"
    if mime in ("text/html", "application/pdf", "text/plain"):
        return "article"
    return "article"


def _extract_tags(text: str) -> list[str]:
    """Extract hashtags from text."""
    tags = re.findall(r"#([\w一-鿿][\w一-鿿_-]*)", text)
    seen: set[str] = set()
    result = []
    for tag in tags:
        if tag.lower() not in seen:
            seen.add(tag.lower())
            result.append(tag)
    return result


class ContentPipeline:
    """Unified content understanding pipeline.

    Usage::

        config = ContentConfig(backends={...}, video_backend="mimo", ...)
        pipeline = ContentPipeline(config)
        result = pipeline.understand("https://youtube.com/watch?v=...")
    """

    def __init__(self, config: ContentConfig) -> None:
        self.config = config
        self._resolver_chain: ResolverChain | None = None

    @property
    def resolver_chain(self) -> ResolverChain:
        if self._resolver_chain is None:
            self._resolver_chain = self._build_resolver_chain()
        return self._resolver_chain

    def _build_resolver_chain(self) -> ResolverChain:
        """Build the default resolver chain."""
        resolvers = [
            LocalFileResolver(),
            DirectURLResolver(),
            SearchEngineResolver(),
            HttpPageResolver(),
        ]
        try:
            from content_understand.resolvers.bilibili import BilibiliResolver

            resolvers.append(BilibiliResolver())
        except ImportError:
            pass

        # Try to add yt-dlp resolver if available
        try:
            from content_understand.resolvers.ytdlp import YtdlpResolver

            resolvers.append(YtdlpResolver())
        except ImportError:
            pass

        return ResolverChain(resolvers)

    def understand(
        self,
        input: str,
        *,
        content_type: str | None = None,
        prompt: str | None = None,
        on_progress: ProgressFn | None = None,
        output_format: str = "text",
    ) -> dict[str, Any]:
        """Understand content from a URL or local file path.

        Args:
            input: URL or local file path.
            content_type: Override auto-detection ("video", "image", "audio", "article").
            prompt: Custom prompt for the model.
            on_progress: Progress callback (stage, percent, message).
            output_format: "text" for free-form, "json" for structured JSON output.

        Returns:
            Structured result dict with keys:
            type, title, url, platform, author, summary, tags, content_type
            When output_format="json", summary is a validated dict instead of raw text.
        """
        if on_progress:
            on_progress("resolve", 5, "Resolving input...")

        # Step 1: Resolve input to local file + metadata
        ctx = {
            "cache_dir": self.config.cache_dir,
            "cookies_file": self.config.bilibili_cookies,
            "quality": self.config.bilibili_quality,
            "timeout": self.config.http_timeout,
        }

        resolve_result = self.resolver_chain.resolve(input, ctx)

        if on_progress:
            on_progress("download", 30, "Downloaded")

        # Step 2: Detect content type
        detected_type = content_type or self._detect_from_resolve(resolve_result)
        if on_progress:
            on_progress("model", 40, f"Understanding {detected_type}...")

        # Step 3: Route to correct backend
        result = self._understand_content(
            resolve_result,
            detected_type,
            prompt=prompt,
            on_progress=on_progress,
            output_format=output_format,
        )

        # Step 4: Enrich with resolver metadata
        meta = resolve_result.metadata
        result.setdefault("title", meta.get("title", ""))
        result.setdefault("url", resolve_result.original_url)
        result.setdefault("platform", meta.get("platform", ""))
        result.setdefault("author", meta.get("author", ""))
        result.setdefault("type", detected_type)

        # Extract tags from summary if not already present
        if not result.get("tags") and result.get("summary"):
            result["tags"] = _extract_tags(result["summary"])

        if on_progress:
            on_progress("done", 100, "Complete")

        return result

    def _detect_from_resolve(self, result: ResolveResult) -> str:
        """Detect content type from a ResolveResult."""
        ct = result.content_type
        if ct.startswith("video/"):
            return "video"
        if ct.startswith("image/"):
            return "image"
        if ct.startswith("audio/"):
            return "audio"
        return "article"

    def _understand_content(
        self,
        resolve_result: ResolveResult,
        content_type: str,
        *,
        prompt: str | None = None,
        on_progress: ProgressFn | None = None,
        output_format: str = "text",
    ) -> dict[str, Any]:
        """Route to the correct model backend based on content type.

        Uses the new ContentModel system when available, falls back to
        legacy per-modality models for backward compatibility.
        """
        local_path = resolve_result.local_path
        backend_name, backend_config = self.config.backend_for_content_type(content_type)

        # Prompt priority: user custom > config template > language-aware default
        lang = getattr(self.config, "output_language", "zh") or "zh"
        if prompt:
            effective_prompt = prompt
        elif self.config.prompt_template:
            effective_prompt = self.config.prompt_template
        else:
            defaults = _DEFAULT_PROMPTS.get(content_type, {})
            effective_prompt = defaults.get(lang, defaults.get("zh", ""))

        # Try new ContentModel path first
        if has_content_model(backend_name):
            try:
                return self._understand_with_content_model(
                    resolve_result, content_type, backend_name, backend_config,
                    effective_prompt, on_progress, lang,
                    output_format=output_format,
                )
            except Exception as exc:
                logger.warning(
                    "ContentModel '%s' failed for %s (%s), falling back to legacy",
                    backend_name, content_type, exc,
                )

        # Legacy per-modality path
        try:
            if content_type == "video":
                return self._understand_video(
                    local_path, backend_name, backend_config, effective_prompt, on_progress, lang
                )
            elif content_type == "image":
                return self._understand_image(
                    local_path, backend_name, backend_config, effective_prompt, lang
                )
            elif content_type == "audio":
                return self._understand_audio(
                    local_path, backend_name, backend_config, effective_prompt, lang
                )
            else:  # article
                return self._understand_article(
                    local_path, resolve_result, backend_name, backend_config, effective_prompt, lang
                )
        except (NotImplementedError, ValueError) as exc:
            logger.warning(
                "Backend '%s' doesn't support %s (%s), falling back to article",
                backend_name, content_type, exc,
            )
            return self._understand_article(
                local_path, resolve_result, backend_name, backend_config, effective_prompt, lang
            )

    def _understand_with_content_model(
        self,
        resolve_result: ResolveResult,
        content_type: str,
        backend_name: str,
        backend_config: Any,
        prompt: str,
        on_progress: ProgressFn | None,
        language: str,
        output_format: str = "text",
    ) -> dict[str, Any]:
        """New unified understanding path using ContentModel.

        Flow:
        1. Create ContentModel from registry
        2. Get model capabilities
        3. Build ContentBundle with capability-aware preprocessing
        4. If output_format="json", build structured prompt with schema
        5. Call model.understand(bundle)
        6. Validate output if JSON mode
        7. Clean up temp files
        """
        model = create_content_model(backend_name, backend_config)
        caps = model.capabilities()

        if on_progress:
            on_progress("model", 40, f"Understanding {content_type} with {backend_name}...")

        # Build frame config from backend config extra
        extra = getattr(backend_config, "extra", {}) or {}
        frame_config = FrameConfig(
            fps=extra.get("fps", caps.default_fps),
            max_frames=extra.get("max_frames", 30),
            scale=extra.get("scale", caps.default_scale),
        )

        # Prepare content bundle with capability-aware preprocessing
        preprocessor = ContentPreprocessor(frame_config=frame_config)
        bundle = preprocessor.prepare(
            input_path=resolve_result.local_path,
            capabilities=caps,
            content_type=content_type,
        )

        # Enrich bundle with resolver metadata
        meta = resolve_result.metadata
        bundle.metadata = meta
        bundle.original_url = resolve_result.original_url
        bundle.local_path = resolve_result.local_path

        # Build effective prompt (structured if JSON mode)
        effective_prompt = prompt
        json_schema = None
        if output_format == "json":
            json_schema = get_schema_for_type(content_type).model_json_schema()
            if not prompt:
                effective_prompt = build_structured_prompt(content_type, language)

        if on_progress:
            on_progress("model", 50, f"Analyzing with {backend_name}...")

        try:
            summary = model.understand(
                bundle=bundle,
                prompt=effective_prompt,
                timeout=backend_config.timeout,
                language=language,
                frame_config=frame_config,
                output_format=output_format,
                json_schema=json_schema,
            )
        finally:
            # Clean up temporary preprocessed files
            preprocessor.cleanup_bundle(bundle)

        # Validate structured output
        if output_format == "json" and isinstance(summary, str):
            # Model returned string instead of parsed JSON — validate manually
            schema_class = get_schema_for_type(content_type)
            validated = validate_or_fallback(summary, schema_class, content_type)
            return {"summary": validated, "tags": validated.get("tags", [])}
        elif output_format == "json" and isinstance(summary, dict):
            # Model returned parsed dict — validate against schema
            schema_class = get_schema_for_type(content_type)
            validated = validate_or_fallback(
                __import__("json").dumps(summary, ensure_ascii=False),
                schema_class,
                content_type,
            )
            return {"summary": validated, "tags": validated.get("tags", [])}

        return {"summary": summary, "tags": _extract_tags(summary)}

    def _understand_video(
        self,
        path: str,
        backend_name: str,
        config,
        prompt: str,
        on_progress: ProgressFn | None,
        language: str = "zh",
    ) -> dict[str, Any]:
        model = create_video_model(backend_name, config)

        if on_progress:
            on_progress("model", 50, f"Analyzing video with {backend_name}...")

        # Try URL mode first if supported
        video_url = None
        if model.supports_video_url() and path.startswith("http"):
            video_url = path

        summary = model.understand_video(
            video_path=path if not video_url else None,
            video_url=video_url,
            prompt=prompt,
            fps=config.extra.get("fps", 2.0),
            timeout=config.timeout,
            language=language,
        )

        return {"summary": summary, "tags": _extract_tags(summary)}

    def _understand_image(
        self,
        path: str,
        backend_name: str,
        config,
        prompt: str,
        language: str = "zh",
    ) -> dict[str, Any]:
        model = create_image_model(backend_name, config)

        image_url = None
        if model.supports_image_url() and path.startswith("http"):
            image_url = path

        summary = model.understand_image(
            image_path=path if not image_url else None,
            image_url=image_url,
            prompt=prompt,
            timeout=config.timeout,
            language=language,
        )

        return {"summary": summary, "tags": _extract_tags(summary)}

    def _understand_audio(
        self,
        path: str,
        backend_name: str,
        config,
        prompt: str,
        language: str = "zh",
    ) -> dict[str, Any]:
        model = create_audio_model(backend_name, config)

        summary = model.understand_audio(
            audio_path=path,
            prompt=prompt,
            timeout=config.timeout,
            language=language,
        )

        return {"summary": summary, "tags": _extract_tags(summary)}

    def _understand_article(
        self,
        path: str,
        resolve_result: ResolveResult,
        backend_name: str,
        config,
        prompt: str,
        language: str = "zh",
    ) -> dict[str, Any]:
        # Extract text from the content
        text = self._extract_text(path, resolve_result)
        if not text:
            return {"summary": "Could not extract text content.", "tags": []}

        model = create_article_model(backend_name, config)

        title = resolve_result.metadata.get("title", "")
        url = resolve_result.original_url

        summary = model.understand_article(
            text=text,
            title=title,
            url=url,
            prompt=prompt,
            timeout=config.timeout,
            language=language,
        )

        return {"summary": summary, "tags": _extract_tags(summary)}

    def _extract_text(self, path: str, resolve_result: ResolveResult) -> str:
        """Extract text from a file based on its content type."""
        ct = resolve_result.content_type

        if ct == "text/html" or path.endswith((".html", ".htm")):
            try:
                from content_understand.extractors.html import extract_html

                result = extract_html(path, url=resolve_result.original_url)
                return result.text
            except (ImportError, RuntimeError) as e:
                logger.warning("HTML extraction failed: %s", e)
                # Fallback: read raw
                try:
                    return Path(path).read_text(encoding="utf-8", errors="replace")[:60000]
                except Exception:
                    return ""

        if ct == "application/pdf" or path.endswith(".pdf"):
            try:
                from content_understand.extractors.pdf import extract_pdf

                result = extract_pdf(path, url=resolve_result.original_url)
                return result.text
            except (ImportError, RuntimeError) as e:
                logger.warning("PDF extraction failed: %s", e)
                return ""

        # Plain text or other
        try:
            return Path(path).read_text(encoding="utf-8", errors="replace")[:60000]
        except Exception:
            return ""

    def add_resolver(self, resolver) -> None:
        """Add a custom resolver to the chain."""
        self.resolver_chain.add_resolver(resolver)
