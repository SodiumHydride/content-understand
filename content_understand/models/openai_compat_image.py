"""OpenAI-compatible image understanding backend.

Works with any OpenAI-compatible vision API:
- Ollama (with vision models like llava, gemma3)
- llama.cpp (with mmproj)
- LM Studio
- vLLM
"""

from __future__ import annotations

import base64
import logging
from pathlib import Path

from content_understand._keys import KeyRotator, rotate_request
from content_understand.models.image_base import ImageModel

logger = logging.getLogger(__name__)


class OpenAICompatImageModel(ImageModel):
    """OpenAI-compatible image understanding via chat completions with vision."""

    def __init__(self, config) -> None:
        self.api_base = config.api_base.rstrip("/")
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.image_model or config.model or ""
        self.max_tokens = config.max_tokens or 4096
        self.timeout = config.timeout or 120

    def _call_api(self, body: dict, timeout: int) -> str:
        url = f"{self.api_base}/chat/completions"
        return rotate_request(
            url, body, self.rotator, timeout, "openai-compat:image",
        )

    def understand_image(
        self,
        image_path: str | None = None,
        image_url: str | None = None,
        prompt: str = "",
        timeout: int = 60,
    ) -> str:
        if not image_path and not image_url:
            raise ValueError("Either image_path or image_url is required")

        content = []

        if image_path:
            data = Path(image_path).read_bytes()
            b64 = base64.b64encode(data).decode()
            ext = Path(image_path).suffix.lower().lstrip(".")
            mime = {"jpg": "jpeg", "jpeg": "jpeg", "png": "png", "gif": "gif", "webp": "webp"}.get(ext, "jpeg")
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/{mime};base64,{b64}"},
            })
        else:
            content.append({
                "type": "image_url",
                "image_url": {"url": image_url},
            })

        if not prompt:
            prompt = "请详细分析这张图片，按以下结构输出：\n\n## 摘要\n描述图片的主要内容\n\n## 要点\n- 列出图片中的关键元素\n\n## 标签\n给出 5-10 个相关标签\n\n## 总结\n用 1-2 句话总结图片主旨"

        content.append({"type": "text", "text": prompt})

        body = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": self.max_tokens,
        }

        return self._call_api(body, timeout or self.timeout)

    def supports_image_url(self) -> bool:
        return True
