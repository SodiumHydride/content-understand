"""Content preprocessor — decomposes inputs based on model capabilities.

Design:
- FrameConfig: configurable frame extraction parameters (replaces hardcoded fps/max_frames)
- AudioConfig: audio separation parameters
- ContentPreprocessor: the single entry point that builds ContentBundle from raw input

The preprocessor is capability-aware: it only does work the model needs.
No frame extraction if the model eats video natively.
No audio separation if the model ignores audio.
"""

from __future__ import annotations

import base64
import logging
import os
import shutil
import subprocess
import tempfile
from collections.abc import Generator
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from pathlib import Path

from content_understand.capabilities import (
    ContentBundle,
    InputStrategy,
    ModelCapabilities,
)

logger = logging.getLogger(__name__)


@contextmanager
def _ffmpeg_safe_path(path: str | Path) -> Generator[str, None, None]:
    """Yield a path safe for ffmpeg on Windows.

    On Windows, ffmpeg may not handle non-ASCII paths (Chinese, Japanese, etc.)
    in -i arguments.  When the path contains non-ASCII characters, create a
    temporary symlink with an ASCII-only name and yield that instead.
    """
    path = str(path)
    if os.name != "nt" or path.isascii():
        yield path
        return
    with tempfile.TemporaryDirectory(prefix="cu_ff_") as td:
        ext = os.path.splitext(path)[1]
        link = os.path.join(td, f"input{ext}")
        try:
            os.symlink(path, link)
            yield link
        except OSError:
            # Symlink may require privileges on some Windows configs; fall back
            yield path


@dataclass
class FrameConfig:
    """Frame extraction configuration — user-adjustable, replaces hardcoded values.

    Default values are chosen for general-purpose video understanding:
    - 1 FPS matches Gemini's default and works well for most content
    - 30 frames covers ~30 seconds at 1fps, or ~15 seconds at 2fps
    - Uniform sampling for consistent temporal coverage
    """

    fps: float = 1.0  # Frames per second (0.1 ~ 5.0)
    max_frames: int = 30  # Maximum number of frames to extract
    scale: str = ""  # FFmpeg scale filter (e.g. "512:-2", "720:-2", "" = original)
    strategy: str = "uniform"  # "uniform" | "scene_aware"
    quality: int = 5  # JPEG quality (1-31, lower = better, FFmpeg -q:v)
    visual_token_budget: int = 70  # Per-frame token budget (Gemma 4 concept)
    scene_threshold: float = 0.3  # Scene change detection threshold (0.0-1.0)

    def effective_fps(self, duration_seconds: float | None) -> float:
        """Calculate effective FPS considering max_frames constraint.

        If the video is long and max_frames would be exceeded, reduce fps.
        """
        if duration_seconds is None or duration_seconds <= 0:
            return self.fps
        max_by_duration = self.max_frames / duration_seconds
        return min(self.fps, max_by_duration)


@dataclass
class FrameTimestamp:
    """Timestamp information for an extracted frame."""

    path: Path
    timestamp_seconds: float
    index: int

    @property
    def mmss(self) -> str:
        """Format as MM:SS."""
        m, s = divmod(int(self.timestamp_seconds), 60)
        return f"{m:02d}:{s:02d}"


@dataclass
class AudioChunk:
    """A 30-second audio segment with time range."""

    path: str
    start_seconds: float
    end_seconds: float
    index: int

    @property
    def duration(self) -> float:
        return self.end_seconds - self.start_seconds

    @property
    def mmss_range(self) -> str:
        s_m, s_s = divmod(int(self.start_seconds), 60)
        e_m, e_s = divmod(int(self.end_seconds), 60)
        return f"{s_m:02d}:{s_s:02d}-{e_m:02d}:{e_s:02d}"



@dataclass
class AudioConfig:
    """Audio separation configuration."""

    sample_rate: int = 16000  # Output sample rate
    channels: int = 1  # Mono output
    format: str = "wav"  # Output format
    max_duration_seconds: int = 3600  # 1 hour cap
    bitrate: str = "128k"  # Audio bitrate for encoding


class ContentPreprocessor:
    """Capability-aware content preprocessor.

    Given a raw input (file path or URL) and a model's capabilities,
    produces a ContentBundle with exactly the materials the model needs.

    Usage:
        preprocessor = ContentPreprocessor()
        bundle = preprocessor.prepare(
            input_path="/path/to/video.mp4",
            capabilities=model.capabilities(),
            frame_config=FrameConfig(fps=2.0, max_frames=50),
        )
        # bundle.frames filled if model needs frames
        # bundle.audio_path filled if model needs audio
        # bundle.video_path always filled (raw video)
    """

    def __init__(
        self,
        frame_config: FrameConfig | None = None,
        audio_config: AudioConfig | None = None,
    ) -> None:
        self.frame_config = frame_config or FrameConfig()
        self.audio_config = audio_config or AudioConfig()

    def prepare(
        self,
        input_path: str,
        capabilities: ModelCapabilities,
        content_type: str | None = None,
        frame_config: FrameConfig | None = None,
        audio_config: AudioConfig | None = None,
    ) -> ContentBundle:
        """Build a ContentBundle from raw input, based on model capabilities.

        This is the main entry point. It:
        1. Detects content type if not provided
        2. Determines the input strategy
        3. Preprocesses only what the model needs
        4. Returns a ContentBundle ready for model consumption
        """
        fc = frame_config or self.frame_config
        ac = audio_config or self.audio_config

        # Resolve absolute path
        abs_path = str(Path(input_path).expanduser().resolve())
        detected_type = content_type or self._detect_content_type(abs_path)

        bundle = ContentBundle(
            video_path=abs_path if detected_type == "video" else None,
            audio_path=abs_path if detected_type == "audio" else None,
            images=[Path(abs_path)] if detected_type == "image" else [],
            text=None,
            content_type=detected_type,
            local_path=abs_path,
        )

        # Warn early if ffmpeg is missing for video/audio content
        if detected_type in ("video", "audio") and not shutil.which("ffmpeg"):
            logger.error(
                "ffmpeg is not installed. %s processing will be degraded.\n"
                "Install: brew install ffmpeg (macOS) | apt install ffmpeg (Linux) | "
                "winget install ffmpeg (Windows)",
                detected_type.capitalize(),
            )

        # Get video duration if applicable
        if detected_type == "video":
            bundle.duration_seconds = self._get_duration(abs_path)

        # Determine strategy and preprocess accordingly
        strategy = capabilities.best_input_strategy(bundle)
        logger.info("Input strategy: %s (model accepts: %s)", strategy, capabilities.accepts)

        self._apply_strategy(bundle, strategy, capabilities, fc, ac)

        return bundle

    def _apply_strategy(
        self,
        bundle: ContentBundle,
        strategy: InputStrategy,
        capabilities: ModelCapabilities,
        fc: FrameConfig,
        ac: AudioConfig,
    ) -> None:
        """Apply the chosen input strategy — fill bundle fields accordingly."""

        if strategy == InputStrategy.NATIVE_VIDEO_AUDIO:
            # Model handles everything natively. Just pass the file path.
            # Optionally encode to base64 if model needs it.
            if not capabilities.supports_url_input and capabilities.supports_base64_input:
                bundle.video_base64 = self._encode_base64(bundle.video_path)
            return

        if strategy == InputStrategy.VIDEO_NATIVE_PLUS_AUDIO_SEPARATE:
            # Model handles video natively but needs audio separately
            if not capabilities.supports_url_input:
                bundle.video_base64 = self._encode_base64(bundle.video_path)
            bundle.audio_path = self._extract_audio(bundle.video_path, ac)
            return

        if strategy == InputStrategy.VIDEO_NATIVE_ONLY:
            # Model handles video natively, ignore audio
            if not capabilities.supports_url_input:
                bundle.video_base64 = self._encode_base64(bundle.video_path)
            return

        if strategy == InputStrategy.FRAMES_PLUS_AUDIO:
            # Scene-aware frame extraction + audio transcription
            if fc.strategy == "scene_aware":
                bundle.frames, bundle.frame_timestamps = self._extract_frames_scene_aware(
                    bundle.video_path,
                    fc,
                )
            else:
                bundle.frames = self._extract_frames(bundle.video_path, capabilities, fc)
            # Extract audio and transcribe with Whisper
            bundle.audio_path, bundle.audio_chunks = self._extract_audio_chunks(
                bundle.video_path,
                ac,
            )
            if bundle.audio_path:
                transcript = self._transcribe_audio(bundle.audio_path)
                if transcript:
                    bundle.text = transcript
                    logger.info("Audio transcript: %d chars", len(transcript))
            return

        if strategy == InputStrategy.FRAMES_ONLY:
            # Extract frames only (with scene awareness if configured)
            if fc.strategy == "scene_aware":
                bundle.frames, bundle.frame_timestamps = self._extract_frames_scene_aware(
                    bundle.video_path,
                    fc,
                )
            else:
                bundle.frames = self._extract_frames(bundle.video_path, capabilities, fc)
            return

        if strategy == InputStrategy.AUDIO_ONLY:
            # Already set in bundle
            return

        if strategy == InputStrategy.TRANSCRIBE_THEN_TEXT:
            # Will be handled by the model (transcribe → text analysis)
            return

        if strategy == InputStrategy.TEXT_ONLY:
            # Text-only, nothing to preprocess
            return

    def _extract_frames(
        self,
        video_path: str,
        capabilities: ModelCapabilities,
        fc: FrameConfig,
    ) -> list[Path]:
        """Extract frames from video using FFmpeg.

        Respects:
        - fps: frame rate
        - max_frames: cap on number of frames
        - scale: resolution scaling
        - quality: JPEG quality
        - duration-aware fps adjustment
        """
        if not shutil.which("ffmpeg"):
            logger.warning("ffmpeg not available, cannot extract frames")
            return []

        tmpdir = Path(tempfile.mkdtemp(prefix="cu_frames_"))
        effective_fps = fc.effective_fps(self._get_duration(video_path))

        vf = f"fps={effective_fps}"
        if fc.scale:
            vf = f"{vf},{fc.scale}"

        try:
            with _ffmpeg_safe_path(video_path) as safe_in:
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-i",
                    safe_in,
                    "-vf",
                    vf,
                    "-frames:v",
                    str(fc.max_frames),
                    "-q:v",
                    str(fc.quality),
                    str(tmpdir / "frame_%06d.jpg"),
                ]
                result = subprocess.run(cmd, capture_output=True, timeout=300)
            if result.returncode != 0:
                logger.warning(
                    "Frame extraction failed: %s", result.stderr.decode(errors="replace")[:300]
                )
                shutil.rmtree(tmpdir, ignore_errors=True)
                return []

            frames = sorted(tmpdir.glob("frame_*.jpg"))
            logger.info(
                "Extracted %d frames at %.1f fps from %s", len(frames), effective_fps, video_path
            )
            return frames

        except subprocess.TimeoutExpired:
            logger.error("Frame extraction timed out for %s", video_path)
            shutil.rmtree(tmpdir, ignore_errors=True)
            return []
        except Exception as e:
            logger.error("Frame extraction error: %s", e)
            shutil.rmtree(tmpdir, ignore_errors=True)
            return []

    def _extract_frames_scene_aware(
        self,
        video_path: str,
        fc: FrameConfig,
    ) -> tuple[list[Path], list[FrameTimestamp]]:
        """Extract frames using scene change detection + uniform fallback.

        Strategy:
        1. Use ffmpeg scene detection to find key frames (high visual change)
        2. Supplement with uniform sampling to ensure full coverage
        3. Deduplicate nearby frames (< 2 seconds apart)
        4. Cap at max_frames total

        Returns (frame_paths, frame_timestamps).
        """
        if not shutil.which("ffmpeg"):
            logger.warning("ffmpeg not available, cannot extract frames")
            return [], []

        duration = self._get_duration(video_path)
        tmpdir = Path(tempfile.mkdtemp(prefix="cu_frames_"))

        try:
            # Step 1: Scene change detection — find timestamps with high visual change
            scene_timestamps = self._detect_scene_changes(video_path, fc, tmpdir, duration)

            # Step 2: Uniform sampling to fill gaps
            uniform_timestamps = self._uniform_sample(
                video_path, fc, tmpdir, duration, start_index=len(scene_timestamps)
            )

            # Step 3: Merge, deduplicate, and cap
            all_timestamps = scene_timestamps + uniform_timestamps
            all_timestamps.sort(key=lambda t: t.timestamp_seconds)
            merged = self._deduplicate_nearby(all_timestamps, min_gap_seconds=2.0)

            # Cap at max_frames
            if len(merged) > fc.max_frames:
                # Keep evenly distributed subset
                step = len(merged) / fc.max_frames
                merged = [merged[int(i * step)] for i in range(fc.max_frames)]
                # Re-index
                for i, ft in enumerate(merged):
                    ft.index = i

            frame_paths = [ft.path for ft in merged]
            logger.info(
                "Scene-aware extraction: %d frames from %s (%.0fs video)",
                len(frame_paths),
                video_path,
                duration or 0,
            )
            return frame_paths, merged

        except Exception as e:
            logger.error("Scene-aware frame extraction error: %s", e)
            shutil.rmtree(tmpdir, ignore_errors=True)
            return [], []

    def _detect_scene_changes(
        self,
        video_path: str,
        fc: FrameConfig,
        tmpdir: Path,
        duration: float | None,
    ) -> list[FrameTimestamp]:
        """Use ffmpeg scene detection to find key frames."""
        scene_dir = tmpdir / "scene"
        scene_dir.mkdir(exist_ok=True)

        vf_parts = [f"select='gt(scene,{fc.scene_threshold})'"]
        if fc.scale:
            vf_parts.append(fc.scale)
        vf = ",".join(vf_parts) + ",setpts=N/FRAME_RATE/TB"

        with _ffmpeg_safe_path(video_path) as safe_in:
            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                safe_in,
                "-vf",
                vf,
                "-vsync",
                "vfr",
                "-frames:v",
                str(fc.max_frames // 2),  # Reserve half for scene frames
                "-q:v",
                str(fc.quality),
                str(scene_dir / "scene_%06d.jpg"),
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=120)
        if result.returncode != 0:
            logger.debug(
                "Scene detection returned %d: %s",
                result.returncode,
                result.stderr.decode(errors="replace")[:200],
            )
            return []

        # Get timestamps from ffmpeg using showinfo filter
        timestamps = self._get_frame_timestamps(video_path, scene_dir)
        return timestamps

    def _uniform_sample(
        self,
        video_path: str,
        fc: FrameConfig,
        tmpdir: Path,
        duration: float | None,
        start_index: int = 0,
    ) -> list[FrameTimestamp]:
        """Uniform frame sampling to ensure full video coverage."""
        uniform_dir = tmpdir / "uniform"
        uniform_dir.mkdir(exist_ok=True)

        # Calculate fps to fill remaining frame budget
        remaining_frames = max(1, fc.max_frames // 2)
        if duration and duration > 0:
            effective_fps = min(fc.fps, remaining_frames / duration)
        else:
            effective_fps = fc.fps

        vf = f"fps={effective_fps}"
        if fc.scale:
            vf = f"{vf},{fc.scale}"

        with _ffmpeg_safe_path(video_path) as safe_in:
            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                safe_in,
                "-vf",
                vf,
                "-frames:v",
                str(remaining_frames),
                "-q:v",
                str(fc.quality),
                str(uniform_dir / "uni_%06d.jpg"),
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=300)
        if result.returncode != 0:
            return []

        timestamps = self._get_frame_timestamps(video_path, uniform_dir, start_index=start_index)
        return timestamps

    def _get_frame_timestamps(
        self,
        video_path: str,
        frame_dir: Path,
        start_index: int = 0,
    ) -> list[FrameTimestamp]:
        """Get timestamps for extracted frames using ffprobe showinfo for accuracy."""
        frames = sorted(frame_dir.glob("*.jpg"))
        if not frames:
            return []

        # Try ffprobe to get real frame timestamps from the source video
        real_timestamps = self._get_real_frame_timestamps(video_path)

        result = []
        for i, frame_path in enumerate(frames):
            if real_timestamps and i < len(real_timestamps):
                ts = real_timestamps[i]
            else:
                # Fallback: linear interpolation
                duration = self._get_duration(video_path) or 0
                ts = i / (len(frames) - 1) * duration if len(frames) > 1 and duration > 0 else 0.0
            result.append(
                FrameTimestamp(
                    path=frame_path,
                    timestamp_seconds=ts,
                    index=start_index + i,
                )
            )
        return result

    def _get_real_frame_timestamps(self, video_path: str) -> list[float] | None:
        """Use ffprobe to extract PTS timestamps of keyframes from the source video."""
        import json as _json

        try:
            cmd = [
                "ffprobe",
                "-v", "quiet",
                "-select_streams", "v:0",
                "-show_entries", "frame=pts_time",
                "-of", "json",
                video_path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if result.returncode != 0:
                return None
            data = _json.loads(result.stdout)
            frames = data.get("frames", [])
            if not frames:
                return None
            timestamps = []
            for f in frames:
                pts = f.get("pts_time")
                if pts is not None:
                    with suppress(ValueError, TypeError):
                        timestamps.append(float(pts))
            return timestamps if timestamps else None
        except Exception:
            return None

    def _deduplicate_nearby(
        self,
        timestamps: list[FrameTimestamp],
        min_gap_seconds: float = 2.0,
    ) -> list[FrameTimestamp]:
        """Remove frames that are too close together, keeping scene-change frames priority."""
        if not timestamps:
            return []

        result = [timestamps[0]]
        for ft in timestamps[1:]:
            if ft.timestamp_seconds - result[-1].timestamp_seconds >= min_gap_seconds:
                result.append(ft)
        return result

    def _extract_audio_chunks(
        self,
        video_path: str,
        ac: AudioConfig,
        chunk_duration: float = 30.0,
    ) -> tuple[str | None, list[AudioChunk]]:
        """Extract audio track and split into chunks.

        Returns (full_audio_path, chunks).
        Each chunk is a separate file with ~chunk_duration seconds.
        """
        if not shutil.which("ffmpeg"):
            logger.warning("ffmpeg not available, cannot extract audio")
            return None, []

        duration = self._get_duration(video_path) or 0
        if duration <= 0:
            return None, []

        # Extract full audio first
        tmpdir = tempfile.mkdtemp(prefix="cu_audio_")
        full_audio_path = os.path.join(tmpdir, f"audio_full.{ac.format}")

        try:
            with _ffmpeg_safe_path(video_path) as safe_in:
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-i",
                    safe_in,
                    "-vn",
                    "-acodec",
                    "pcm_s16le" if ac.format == "wav" else "aac",
                    "-ar",
                    str(ac.sample_rate),
                    "-ac",
                    str(ac.channels),
                    "-b:a",
                    ac.bitrate,
                    full_audio_path,
                ]
                result = subprocess.run(cmd, capture_output=True, timeout=300)
            if result.returncode != 0:
                logger.warning(
                    "Audio extraction failed: %s", result.stderr.decode(errors="replace")[:200]
                )
                return None, []
        except Exception as e:
            logger.error("Audio extraction error: %s", e)
            return None, []

        # Split into chunks
        chunks = []
        num_chunks = max(1, int(duration / chunk_duration) + 1)
        for i in range(num_chunks):
            start = i * chunk_duration
            end = min((i + 1) * chunk_duration, duration)
            if start >= duration:
                break

            chunk_path = os.path.join(
                tmpdir, f"chunk_{i:03d}_{int(start)}s-{int(end)}s.{ac.format}"
            )
            chunk_cmd = [
                "ffmpeg",
                "-y",
                "-i",
                full_audio_path,
                "-ss",
                str(start),
                "-t",
                str(end - start),
                "-c",
                "copy",
                chunk_path,
            ]

            try:
                chunk_result = subprocess.run(chunk_cmd, capture_output=True, timeout=60)
                if chunk_result.returncode == 0 and os.path.exists(chunk_path):
                    chunks.append(
                        AudioChunk(
                            path=chunk_path,
                            start_seconds=start,
                            end_seconds=end,
                            index=i,
                        )
                    )
            except Exception as e:
                logger.debug("Audio chunk %d failed: %s", i, e)

        logger.info(
            "Audio: extracted %d chunks (%.0fs total) from %s", len(chunks), duration, video_path
        )
        return full_audio_path, chunks

    def _transcribe_audio(self, audio_path: str) -> str | None:
        """Transcribe audio using Whisper (if available).

        Returns transcript text, or None if Whisper is not available or fails.
        """
        try:
            import subprocess

            # Check if whisper CLI is available
            result = subprocess.run(
                ["whisper", "--version"],
                capture_output=True,
                timeout=5,
            )
            if result.returncode != 0:
                logger.debug("Whisper not available, skipping transcription")
                return None
        except (FileNotFoundError, subprocess.TimeoutExpired):
            logger.debug("Whisper not available, skipping transcription")
            return None

        try:
            import tempfile

            output_dir = tempfile.mkdtemp(prefix="cu_whisper_")
            cmd = [
                "whisper",
                audio_path,
                "--model",
                "base",
                "--output_format",
                "txt",
                "--output_dir",
                output_dir,
                "--language",
                "zh",
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if result.returncode != 0:
                # Try without language hint
                cmd_no_lang = [
                    "whisper",
                    audio_path,
                    "--model",
                    "base",
                    "--output_format",
                    "txt",
                    "--output_dir",
                    output_dir,
                ]
                result = subprocess.run(cmd_no_lang, capture_output=True, text=True, timeout=300)

            if result.returncode != 0:
                logger.warning("Whisper transcription failed: %s", result.stderr[:200])
                return None

            # Read transcript
            import glob as glob_mod

            txt_files = glob_mod.glob(os.path.join(output_dir, "*.txt"))
            if txt_files:
                with open(txt_files[0], encoding="utf-8") as f:
                    transcript = f.read().strip()
                # Cleanup
                shutil.rmtree(output_dir, ignore_errors=True)
                return transcript if transcript else None

            shutil.rmtree(output_dir, ignore_errors=True)
            return None

        except subprocess.TimeoutExpired:
            logger.warning("Whisper transcription timed out")
            return None
        except Exception as e:
            logger.warning("Whisper transcription error: %s", e)
            return None

    def _extract_audio(
        self,
        video_path: str,
        ac: AudioConfig,
    ) -> str | None:
        """Extract audio track from video using FFmpeg.

        Returns path to the extracted audio file, or None on failure.
        """
        if not shutil.which("ffmpeg"):
            logger.warning("ffmpeg not available, cannot extract audio")
            return None

        tmpdir = tempfile.mkdtemp(prefix="cu_audio_")
        output_path = os.path.join(tmpdir, f"audio.{ac.format}")

        try:
            with _ffmpeg_safe_path(video_path) as safe_in:
                cmd = [
                    "ffmpeg",
                    "-y",
                    "-i",
                    safe_in,
                    "-vn",  # No video
                    "-acodec",
                    "pcm_s16le" if ac.format == "wav" else "aac",
                    "-ar",
                    str(ac.sample_rate),
                    "-ac",
                    str(ac.channels),
                    "-b:a",
                    ac.bitrate,
                    output_path,
                ]
                result = subprocess.run(cmd, capture_output=True, timeout=300)
            if result.returncode == 0 and os.path.exists(output_path):
                size = os.path.getsize(output_path)
                logger.info("Extracted audio: %s (%d bytes)", output_path, size)
                return output_path
            logger.warning(
                "Audio extraction failed: %s", result.stderr.decode(errors="replace")[:200]
            )
            shutil.rmtree(tmpdir, ignore_errors=True)
            return None

        except subprocess.TimeoutExpired:
            logger.error("Audio extraction timed out for %s", video_path)
            shutil.rmtree(tmpdir, ignore_errors=True)
            return None
        except Exception as e:
            logger.error("Audio extraction error: %s", e)
            shutil.rmtree(tmpdir, ignore_errors=True)
            return None

    def _get_duration(self, path: str) -> float | None:
        """Get media duration in seconds using ffprobe."""
        try:
            with _ffmpeg_safe_path(path) as safe_in:
                cmd = [
                    "ffprobe",
                    "-v",
                    "quiet",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=noprint_wrappers=1:nokey=1",
                    safe_in,
                ]
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if result.returncode == 0 and result.stdout.strip():
                return float(result.stdout.strip())
        except Exception as e:
            logger.debug("ffprobe duration error: %s", e)
        return None

    def _detect_content_type(self, path: str) -> str:
        """Detect content type from file extension/MIME."""
        import mimetypes

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

        if mime:
            if mime.startswith("video/"):
                return "video"
            if mime.startswith("image/"):
                return "image"
            if mime.startswith("audio/"):
                return "audio"
            if mime in ("text/html", "application/pdf", "text/plain"):
                return "article"
        return "article"

    _MAX_BASE64_SIZE = 500 * 1024 * 1024  # 500 MB

    @staticmethod
    def _encode_base64(path: str | None) -> str | None:
        """Encode a file to base64 string."""
        if not path or not os.path.exists(path):
            return None
        try:
            size = os.path.getsize(path)
            if size > ContentPreprocessor._MAX_BASE64_SIZE:
                logger.warning(
                    "File too large for base64 encoding: %s (%d bytes > 500 MB limit)",
                    path,
                    size,
                )
                return None
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode()
        except Exception as e:
            logger.error("Base64 encoding failed for %s: %s", path, e)
            return None

    @staticmethod
    def cleanup_bundle(bundle: ContentBundle) -> None:
        """Clean up temporary files created during preprocessing.

        Call this after the model has consumed the bundle.
        """
        # Clean extracted frames
        for frame in bundle.frames:
            try:
                if frame.exists():
                    frame.unlink()
            except OSError:
                pass
        # Clean frame directory if empty
        if bundle.frames:
            try:
                parent = bundle.frames[0].parent
                if parent.exists() and not any(parent.iterdir()):
                    parent.rmdir()
            except OSError:
                pass

        # Clean extracted audio (only if it's a temp file, not the original)
        if bundle.audio_path and bundle.audio_path != bundle.video_path:
            try:
                audio_p = Path(bundle.audio_path)
                if audio_p.exists():
                    os.unlink(bundle.audio_path)
                # Remove the temp audio directory if empty
                audio_dir = audio_p.parent
                if audio_dir.exists() and not any(audio_dir.iterdir()):
                    audio_dir.rmdir()
            except OSError:
                pass

        # Clean audio chunks
        for chunk in bundle.audio_chunks:
            try:
                if os.path.exists(chunk.path):
                    os.unlink(chunk.path)
            except OSError:
                pass
