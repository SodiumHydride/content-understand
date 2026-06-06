"""Claude (Anthropic) image understanding backend."""

from __future__ import annotations

import base64
import logging
from pathlib import Path

import requests

from content_understand._keys import KeyRotator, rotate_request
from content_understand.defaults import CLAUDE_API_BASE, CLAUDE_DEFAULT_MODEL
from content_understand.models.image_base import ImageModel

logger = logging.getLogger(__name__)


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


class ClaudeImageModel(ImageModel):
    """Claude image understanding via Anthropic Messages API."""

    def __init__(self, config) -> None:
        self.api_base = config.api_base or CLAUDE_API_BASE
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.image_model or config.model or CLAUDE_DEFAULT_MODEL
        self.max_tokens = config.max_tokens or 4096
        self.timeout = config.timeout or 120

    def _call_api(self, body: dict, timeout: int) -> str:
        url = f"{self.api_base}/v1/messages"
        return rotate_request(
            url, body, self.rotator, timeout, "claude:image",
            headers_factory=_claude_headers,
            response_extractor=_claude_extractor,
        )

    def understand_image(
        self,
        image_path: str | None = None,
        image_url: str | None = None,
        prompt: str = "",
        timeout: int = 60,
        language: str = "zh",
    ) -> str:
        if not image_path and not image_url:
            raise ValueError("Either image_path or image_url is required")

        # Claude requires base64, so download if URL
        tmp_path = None
        if not image_path and image_url:
            import os
            import tempfile

            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            tmp_path = tmp.name
            try:
                r = requests.get(image_url, timeout=30)
                r.raise_for_status()
                tmp.write(r.content)
                tmp.close()
                image_path = tmp_path
            except Exception:
                tmp.close()
                os.unlink(tmp_path)
                raise

        try:
            mime = _guess_mime(image_path)
            raw = Path(image_path).read_bytes()
            b64 = base64.b64encode(raw).decode()
        finally:
            if tmp_path:
                import os

                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

        content = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime,
                    "data": b64,
                },
            },
            {"type": "text", "text": prompt},
        ]

        body = {
            "model": self.model_name,
            "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": content}],
        }

        return self._call_api(body, timeout or self.timeout)

    def supports_image_url(self) -> bool:
        return False

    def understand_text(self, prompt: str, timeout: int = 60) -> str:
        body = {
            "model": self.model_name,
            "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        return self._call_api(body, timeout)


def _guess_mime(path: str) -> str:
    from content_understand._mime import guess_mime

    return guess_mime(path, default="image/jpeg")
