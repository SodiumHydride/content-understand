"""OpenAI-compatible video understanding backend.

Supports any OpenAI-compatible API:
- llama.cpp (llama-server)
- vLLM
- Ollama
- LM Studio
- Any other OpenAI-compatible endpoint

Video understanding is done by extracting frames and sending them as images.
Local Ollama endpoints use fewer, smaller frames with batched analysis.
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

    def _is_local_endpoint(self) -> bool:
        return "127.0.0.1" in self.api_base or "localhost" in self.api_base

    def _call_api(self, body: dict, timeout: int, label: str = "openai-compat:video") -> str:
        url = f"{self.api_base}/chat/completions"
        return rotate_request(url, body, self.rotator, timeout, label)

    def _extract_frames(
        self,
        video_path: str,
        fps: float = 2.0,
        max_frames: int = 20,
        *,
        scale: str = "",
    ) -> list[str]:
        """Extract frames from video as base64-encoded JPEG images."""
        tmpdir = tempfile.mkdtemp(prefix="vu_frames_")
        try:
            vf = f"fps={fps}"
            if scale:
                vf = f"{vf},{scale}"
            cmd = [
                "ffmpeg",
                "-i",
                video_path,
                "-vf",
                vf,
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

    def _build_vision_body(self, frames: list[str], prompt: str) -> dict:
        content: list[dict] = []
        for frame_b64 in frames:
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"},
                }
            )
        content.append({"type": "text", "text": prompt})
        return {
            "model": self.model_name,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": self.max_tokens,
        }

    def _analyze_frames(self, frames: list[str], prompt: str, timeout: int) -> str:
        return self._call_api(self._build_vision_body(frames, prompt), timeout)

    def _understand_video_local_batched(
        self, frames: list[str], prompt: str, timeout: int
    ) -> str:
        """Analyze local Ollama in small batches to avoid payload OOM / HTTP 500."""
        batch_size = 2
        summaries: list[str] = []

        for i in range(0, len(frames), batch_size):
            batch = frames[i : i + batch_size]
            if i == 0:
                batch_prompt = prompt
            else:
                batch_prompt = (
                    "Continue analyzing this video. Previous segment summary:\n"
                    f"{summaries[-1][:2000]}\n\n"
                    "Analyze these additional frames and extend the analysis:"
                )
            try:
                result = self._analyze_frames(batch, batch_prompt, timeout)
                summaries.append(result)
            except Exception as exc:
                logger.warning(
                    "Batch %d (%d frames) failed: %s — retrying single frame",
                    i // batch_size,
                    len(batch),
                    exc,
                )
                if len(batch) == 1:
                    raise
                result = self._analyze_frames(batch[:1], batch_prompt, timeout)
                summaries.append(result)

        if len(summaries) == 1:
            return summaries[0]

        merge_prompt = (
            "Synthesize these per-segment video analyses into one cohesive structured report:\n\n"
            + "\n\n---\n\n".join(summaries)
        )
        return self._call_api(
            {
                "model": self.model_name,
                "messages": [{"role": "user", "content": merge_prompt}],
                "max_tokens": self.max_tokens,
            },
            timeout,
            "openai-compat:video:merge",
        )

    def understand_video(
        self,
        video_path: str | None = None,
        video_url: str | None = None,
        prompt: str = "",
        fps: float = 2.0,
        timeout: int = 120,
        language: str = "zh",
    ) -> str:
        if not video_path and not video_url:
            raise ValueError("Either video_path or video_url is required")

        if video_path:
            is_local = self._is_local_endpoint()
            max_frames = 4 if is_local else 20
            fps_val = 0.5 if is_local else fps
            scale = "scale=512:-2" if is_local else ""
            timeout_val = max(timeout, 600) if is_local else timeout

            frames = self._extract_frames(
                video_path, fps=fps_val, max_frames=max_frames, scale=scale
            )
            if not frames:
                raise RuntimeError("Failed to extract frames from video")

            if is_local:
                logger.info(
                    "Local Ollama video: %d frames, batched analysis, timeout=%ds",
                    len(frames),
                    timeout_val,
                )
                return self._understand_video_local_batched(frames, prompt, timeout_val)

            return self._analyze_frames(frames, prompt, timeout_val)
        raise RuntimeError(
            "OpenAI-compatible backend requires local video file (video_path)"
        )

    def understand_text(self, prompt: str, timeout: int = 60) -> str:
        body = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": self.max_tokens,
        }
        return self._call_api(body, timeout, "openai-compat:video:text")

    def supports_video_url(self) -> bool:
        return False

    def supports_audio(self) -> bool:
        return False
