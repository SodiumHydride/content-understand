"""MiMo image understanding backend."""

from __future__ import annotations

import base64
import logging
from pathlib import Path

from content_understand._keys import KeyRotator, rotate_request
from content_understand.defaults import MIMO_DEFAULT_MODEL
from content_understand.models.image_base import ImageModel

logger = logging.getLogger(__name__)


class MimoImageModel(ImageModel):
    """MiMo image understanding via OpenAI-compatible API with multi-key rotation."""

    def __init__(self, config) -> None:
        self.api_base = config.api_base
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.image_model or MIMO_DEFAULT_MODEL
        self.max_tokens = config.max_tokens
        self.timeout = config.timeout or 600

    def _post(self, body: dict, timeout: int, label: str) -> str:
        return rotate_request(
            self.api_base, body, self.rotator, timeout, f"mimo-image:{label}"
        )

    def understand_image(
        self,
        image_path: str | None = None,
        image_url: str | None = None,
        prompt: str = "",
        timeout: int = 60,
    ) -> str:
        if not image_url and not image_path:
            raise ValueError("Either image_url or image_path is required")

        if not image_url and image_path:
            mime = _guess_mime(image_path)
            raw = Path(image_path).read_bytes()
            b64 = base64.b64encode(raw).decode()
            image_url = f"data:{mime};base64,{b64}"

        body = {
            "model": self.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": image_url}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            "max_tokens": self.max_tokens,
        }

        return self._post(body, timeout or self.timeout, "image")

    def supports_image_url(self) -> bool:
        return True


def _guess_mime(path: str) -> str:
    from content_understand._mime import guess_mime

    return guess_mime(path, default="image/jpeg")
