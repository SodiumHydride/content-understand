"""MiMo video understanding backend."""

from __future__ import annotations

import logging

from content_understand._keys import KeyRotator, rotate_request
from content_understand.models.base import VideoModel

logger = logging.getLogger(__name__)


class MimoModel(VideoModel):
    """MiMo video understanding backend with multi-key rotation."""

    def __init__(self, config) -> None:
        self.api_base = config.api_base
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_video = config.model or "mimo-v2.5"
        self.model_text = config.model or "mimo-v2.5-pro"
        self.max_tokens = config.max_tokens
        self.timeout = config.timeout

    def _post(self, body: dict, timeout: int, label: str) -> str:
        return rotate_request(
            self.api_base, body, self.rotator, timeout, f"mimo:{label}"
        )

    def understand_video(
        self,
        video_path: str | None = None,
        video_url: str | None = None,
        prompt: str = "",
        fps: float = 2.0,
        timeout: int = 120,
    ) -> str:
        if not video_url and not video_path:
            raise ValueError("Either video_url or video_path is required")

        if not video_url and video_path:
            from content_understand.preprocessors.ffmpeg import FFmpegPreprocessor
            from content_understand.config import FFmpegConfig

            ffmpeg = FFmpegPreprocessor(FFmpegConfig())
            b64 = ffmpeg.encode_to_base64(video_path)
            if not b64:
                raise RuntimeError("Failed to encode video to base64")
            video_url = f"data:video/mp4;base64,{b64}"

        body = {
            "model": self.model_video,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "video_url",
                            "video_url": {"url": video_url, "fps": fps},
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            "max_tokens": self.max_tokens,
            "thinking": {"type": "disabled"},
        }

        return self._post(body, timeout, "video")

    def understand_text(self, prompt: str, timeout: int = 60) -> str:
        body = {
            "model": self.model_text,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": self.max_tokens,
        }
        return self._post(body, timeout, "text")

    def supports_video_url(self) -> bool:
        return True

    def supports_audio(self) -> bool:
        return False
