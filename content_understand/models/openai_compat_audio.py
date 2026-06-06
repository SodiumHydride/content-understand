"""OpenAI-compatible audio — transcribe then summarize for local Ollama."""

from __future__ import annotations

import base64
import logging
import subprocess
import tempfile
from pathlib import Path

from content_understand._keys import KeyRotator, rotate_request
from content_understand.models.audio_base import AudioModel

logger = logging.getLogger(__name__)

_TRANSCRIBE_PROMPT = (
    "Transcribe this audio accurately. Output only the transcript text, no commentary."
)
_SUMMARY_PROMPT: dict[str, str] = {
    "zh": """请根据以下音频转录内容，按结构输出分析：

## 摘要
## 要点
## 标签
## 总结

转录：
{transcript}
""",
    "en": """Based on the following audio transcript, output a structured analysis:

## Summary
## Key Points
## Tags
## Conclusion

Transcript:
{transcript}
""",
}


class OpenAICompatAudioModel(AudioModel):
    """Local/cloud OpenAI-compat audio via transcribe-then-chat."""

    def __init__(self, config) -> None:
        self.api_base = config.api_base.rstrip("/")
        self.rotator = KeyRotator(config.api_keys or [])
        self.model_name = config.audio_model or config.model or ""
        self.max_tokens = config.max_tokens or 4096
        self.timeout = config.timeout or 600

    def _chat(self, prompt: str, timeout: int, label: str) -> str:
        body = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": self.max_tokens,
        }
        return rotate_request(
            f"{self.api_base}/chat/completions",
            body,
            self.rotator,
            timeout,
            f"openai-compat:audio:{label}",
        )

    def _to_wav(self, audio_path: str) -> str:
        out = tempfile.mktemp(suffix=".wav")
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            audio_path,
            "-ar",
            "16000",
            "-ac",
            "1",
            out,
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=120)
        if proc.returncode != 0:
            raise RuntimeError(
                "ffmpeg audio conversion failed. Install ffmpeg for local audio."
            )
        return out

    def _transcribe_with_model(self, wav_path: str, timeout: int) -> str:
        """Try Ollama/OpenAI-compat with base64 wav in a vision-style payload."""
        data = Path(wav_path).read_bytes()
        b64 = base64.b64encode(data).decode()
        body = {
            "model": self.model_name,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {"data": b64, "format": "wav"},
                        },
                        {"type": "text", "text": _TRANSCRIBE_PROMPT},
                    ],
                }
            ],
            "max_tokens": self.max_tokens,
        }
        try:
            return rotate_request(
                f"{self.api_base}/chat/completions",
                body,
                self.rotator,
                timeout,
                "openai-compat:audio:transcribe",
            )
        except Exception as exc:
            logger.info("Native audio API failed, falling back to text-only: %s", exc)
            raise

    def transcribe_audio(
        self,
        audio_path: str,
        language: str = "zh",
        timeout: int = 300,
    ) -> str:
        wav = self._to_wav(audio_path)
        try:
            return self._transcribe_with_model(wav, timeout)
        except Exception:
            body = {
                "model": self.model_name,
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
            return rotate_request(
                f"{self.api_base}/chat/completions",
                body,
                self.rotator,
                timeout,
                "openai-compat:audio:transcribe-fallback",
            )

    def understand_audio(
        self,
        audio_path: str,
        prompt: str = "",
        timeout: int = 600,
        language: str = "zh",
    ) -> str:
        transcript = self.transcribe_audio(audio_path, timeout=min(timeout, 300))
        if not transcript.strip():
            raise RuntimeError("Audio transcription returned empty text")
        if not prompt:
            template = _SUMMARY_PROMPT.get(language, _SUMMARY_PROMPT["zh"])
            prompt = template.format(transcript=transcript[:12000])
        return self._chat(prompt, timeout, "summary")
