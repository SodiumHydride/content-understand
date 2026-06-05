"""OpenAI-compatible video understanding backend.

Supports any OpenAI-compatible API:
- llama.cpp (llama-server)
- vLLM
- Ollama
- LM Studio
- Any other OpenAI-compatible endpoint

Video understanding is done by extracting frames and sending them as images.
"""

from __future__ import annotations

import base64
import logging
import subprocess
import tempfile
from pathlib import Path

from content_understand._keys import KeyRotator, rotate_request
from content_understand.models.base import VideoModel

logger = logging.getLogger(__name__)


class OpenAICompatModel(VideoModel):
    """OpenAI-compatible video understanding backend."""

    def __init__(self, config) -> None:
        self.api_base = config.api_base.rstrip("/")
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.model or ""
        self.max_tokens = config.max_tokens or 4096
        self.timeout = config.timeout or 120

    def _call_api(self, body: dict, timeout: int) -> str:
        url = f"{self.api_base}/chat/completions"
        return rotate_request(
            url, body, self.rotator, timeout, "openai-compat:video",
        )

    def _extract_frames(
        self, video_path: str, fps: float = 2.0, max_frames: int = 20
    ) -> list[str]:
        """Extract frames from video as base64-encoded JPEG images."""
        tmpdir = tempfile.mkdtemp(prefix="vu_frames_")
        try:
            cmd = [
                "ffmpeg",
                "-i",
                video_path,
                "-vf",
                f"fps={fps}",
                "-frames:v",
                str(max_frames),
                "-q:v",
                "5",
                f"{tmpdir}/frame_%04d.jpg",
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=120)
            if result.returncode != 0:
                logger.warning(
                    "ffmpeg frame extraction failed: %s",
                    result.stderr.decode(errors="replace")[:200],
                )
                return []

            frames = []
            for f in sorted(Path(tmpdir).glob("frame_*.jpg")):
                with open(f, "rb") as fh:
                    frames.append(base64.b64encode(fh.read()).decode())

            logger.info("Extracted %d frames at %.1f fps", len(frames), fps)
            return frames

        finally:
            import shutil

            shutil.rmtree(tmpdir, ignore_errors=True)

    def understand_video(
        self,
        video_path: str | None = None,
        video_url: str | None = None,
        prompt: str = "",
        fps: float = 2.0,
        timeout: int = 120,
    ) -> str:
        if not video_path and not video_url:
            raise ValueError("Either video_path or video_url is required")

        if video_path:
            frames = self._extract_frames(video_path, fps=fps)
            if not frames:
                raise RuntimeError("Failed to extract frames from video")
        else:
            raise RuntimeError(
                "OpenAI-compatible backend requires local video file (video_path)"
            )

        content = []
        for frame_b64 in frames:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"},
                }
            )

        content.append({"type": "text", "text": prompt})

        body = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": self.max_tokens,
        }

        return self._call_api(body, timeout)

    def understand_text(self, prompt: str, timeout: int = 60) -> str:
        body = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": self.max_tokens,
        }
        return self._call_api(body, timeout)

    def supports_video_url(self) -> bool:
        return False

    def supports_audio(self) -> bool:
        return False
