"""Claude (Anthropic) content understanding backend.

Implements ContentModel for the Anthropic Messages API.
Supports IMAGE and TEXT modalities. Claude requires base64-encoded images,
so remote URLs are downloaded to temporary files before encoding.
"""

from __future__ import annotations

import base64
import contextlib
import logging
import os
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

import requests

from content_understand._keys import KeyRotator, rotate_request
from content_understand.capabilities import (
    ContentBundle,
    Modality,
    ModelCapabilities,
)
from content_understand.defaults import CLAUDE_API_BASE, CLAUDE_DEFAULT_MODEL
from content_understand.models.base import ContentModel

if TYPE_CHECKING:
    from content_understand.preprocessing import FrameConfig

logger = logging.getLogger(__name__)

_DEFAULT_IMAGE_PROMPT = {
    "zh": "请详细描述这张图片的内容，包括主要元素、场景、文字、风格等。给出 5-10 个相关标签，格式：#标签1 #标签2 ...",
    "en": "Describe this image in detail, including main elements, scene, text, style, etc. Give 5-10 relevant tags, format: #tag1 #tag2 ...",
}


def _claude_headers(key: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
    }


def _claude_extractor(data: dict) -> str | None:
    """Extract text from Claude Messages API response."""
    if data.get("content"):
        for block in data["content"]:
            if block.get("type") == "text" and block.get("text"):
                return block["text"]
    return None


class ClaudeContentModel(ContentModel):
    """Claude content understanding via Anthropic Messages API.

    Accepts IMAGE and TEXT modalities. Vision requests use base64-encoded
    images in the Anthropic Messages format. Text requests are sent as
    plain message content.
    """

    def __init__(self, config: Any) -> None:
        self.api_base = config.api_base or CLAUDE_API_BASE
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.image_model or config.model or CLAUDE_DEFAULT_MODEL
        self.max_tokens = config.max_tokens or 4096
        self.timeout = config.timeout or 120

    def capabilities(self) -> ModelCapabilities:
        return ModelCapabilities(
            accepts=Modality.IMAGE | Modality.TEXT,
            preferred_input=Modality.IMAGE,
            supports_url_input=False,  # Claude requires base64
            supports_base64_input=True,
            supports_native_video=False,
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
    ) -> str:
        if bundle.has_images or bundle.has_frames:
            return self._understand_images(bundle, prompt, timeout, language)
        if bundle.has_text:
            return self._understand_text(bundle, prompt, timeout)
        raise ValueError("Bundle has no images, frames, or text to process")

    def _call_api(self, body: dict, timeout: int) -> str:
        url = f"{self.api_base}/v1/messages"
        return rotate_request(
            url,
            body,
            self.rotator,
            timeout,
            "claude:image",
            headers_factory=_claude_headers,
            response_extractor=_claude_extractor,
        )

    def _understand_images(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
        language: str = "zh",
    ) -> str:
        """Send images/frames to Claude vision API.

        Picks the first available image source from the bundle:
        1. bundle.images (list of Path)
        2. bundle.frames (list of Path)
        3. bundle.original_url (download to tmp, encode as base64)
        """
        image_paths: list[Path] = bundle.images or bundle.frames

        if not image_paths and bundle.original_url:
            # Download remote image to temp file for base64 encoding
            tmp_path = self._download_to_tmp(bundle.original_url)
            try:
                return self._send_vision([tmp_path], prompt, timeout)
            finally:
                with contextlib.suppress(OSError):
                    os.unlink(tmp_path)

        if not image_paths:
            raise ValueError("No images available in bundle")

        return self._send_vision(image_paths, prompt, timeout, language)

    def _send_vision(
        self,
        image_paths: list[Path],
        prompt: str,
        timeout: int,
        language: str = "zh",
    ) -> str:
        """Build and send a vision request with base64-encoded images."""
        if not prompt:
            prompt = _DEFAULT_IMAGE_PROMPT.get(language, _DEFAULT_IMAGE_PROMPT["en"])

        content: list[dict[str, Any]] = []

        for img_path in image_paths:
            mime = _guess_mime(str(img_path))
            raw = Path(img_path).read_bytes()
            b64 = base64.b64encode(raw).decode()
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": mime,
                        "data": b64,
                    },
                }
            )

        if prompt:
            content.append({"type": "text", "text": prompt})

        body = {
            "model": self.model_name,
            "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": content}],
        }

        return self._call_api(body, timeout or self.timeout)

    def _understand_text(
        self,
        bundle: ContentBundle,
        prompt: str,
        timeout: int,
    ) -> str:
        """Send text-only request to Claude."""
        text = bundle.text or ""
        effective_prompt = prompt
        if text:
            effective_prompt = f"{prompt}\n\n{text}" if prompt else text

        body = {
            "model": self.model_name,
            "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": effective_prompt}],
        }
        return self._call_api(body, timeout)

    @staticmethod
    def _download_to_tmp(url: str) -> str:
        """Download a remote image to a temporary file. Caller must unlink."""
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".jpg")
        os.close(tmp_fd)
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            with open(tmp_path, "wb") as f:
                f.write(r.content)
            return tmp_path
        except Exception:
            os.unlink(tmp_path)
            raise


def _guess_mime(path: str) -> str:
    from content_understand._mime import guess_mime

    return guess_mime(path, default="image/jpeg")
