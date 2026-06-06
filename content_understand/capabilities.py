"""Modality capability system — the foundation for intelligent routing.

Design:
- Modality (Flag): atomic input types that can be combined
- ContentBundle: decomposed input materials ready for model consumption
- ModelCapabilities: what a model can accept and prefers
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, Flag, auto
from pathlib import Path
from typing import Any


class Modality(Flag):
    """Atomic modality types — the smallest units of input material.

    Uses Flag (not Enum) so modalities can be combined with bitwise OR:
        caps = Modality.VIDEO | Modality.AUDIO
    """

    TEXT = auto()
    IMAGE = auto()
    AUDIO = auto()
    VIDEO = auto()  # Video frames (visual stream only)
    VIDEO_WITH_AUDIO = auto()  # Video + audio simultaneously (omni models)

    # Composite shortcuts
    VISION = IMAGE | VIDEO  # Any visual input
    OMNI = TEXT | IMAGE | AUDIO | VIDEO | VIDEO_WITH_AUDIO  # Everything

    @classmethod
    def from_content_type(cls, content_type: str) -> Modality:
        """Map legacy content_type string to Modality flag."""
        mapping = {
            "video": cls.VIDEO,
            "image": cls.IMAGE,
            "audio": cls.AUDIO,
            "article": cls.TEXT,
        }
        return mapping.get(content_type, cls.TEXT)


@dataclass
class ContentBundle:
    """Decomposed input materials ready for model consumption.

    A single video file becomes: video_path + frames (optional) + audio_path (optional).
    A single image becomes: images list.
    An article becomes: text.

    The pipeline fills only the fields the model needs, based on its capabilities.
    """

    # Raw inputs
    video_path: str | None = None
    audio_path: str | None = None
    images: list[Path] = field(default_factory=list)
    text: str | None = None

    # Pre-processed materials (filled on demand by ContentPreprocessor)
    frames: list[Path] = field(default_factory=list)
    audio_base64: str | None = None
    video_base64: str | None = None

    # Metadata
    metadata: dict[str, Any] = field(default_factory=dict)
    content_type: str = ""  # "video", "image", "audio", "article"
    duration_seconds: float | None = None

    # Source info
    original_url: str = ""
    local_path: str = ""

    @property
    def has_video(self) -> bool:
        return self.video_path is not None

    @property
    def has_audio(self) -> bool:
        return self.audio_path is not None

    @property
    def has_frames(self) -> bool:
        return len(self.frames) > 0

    @property
    def has_images(self) -> bool:
        return len(self.images) > 0

    @property
    def has_text(self) -> bool:
        return self.text is not None and len(self.text.strip()) > 0


@dataclass
class ModelCapabilities:
    """Declare what a model can accept and how it prefers to receive input.

    Each backend implements a `capabilities()` method returning this.
    The pipeline uses it to decide:
    1. What preprocessing to do (extract frames? separate audio?)
    2. What to pass to the model (raw video? frames + audio? text only?)
    """

    accepts: Modality  # What input types this model can handle
    preferred_input: Modality  # Best-case input (highest quality path)

    # Constraints
    max_video_seconds: int | None = None  # Video duration limit
    max_frames: int | None = None  # Frame count limit
    max_audio_seconds: int | None = None  # Audio duration limit

    # Input format preferences
    supports_url_input: bool = False  # Can accept HTTP URLs directly
    supports_base64_input: bool = True  # Can accept base64-encoded data
    supports_native_video: bool = False  # Can process video file natively (no frame extraction)

    # Processing hints
    default_fps: float = 1.0  # Default frames per second for extraction
    default_scale: str = ""  # Default frame scaling (e.g. "512:-2")

    def can_accept(self, modality: Modality) -> bool:
        """Check if this model can handle a specific modality."""
        return bool(self.accepts & modality)

    def should_extract_frames(self, bundle: ContentBundle) -> bool:
        """Determine if frame extraction is needed."""
        if not bundle.has_video:
            return False
        # If model accepts VIDEO_WITH_AUDIO and has native video support, skip extraction
        if self.accepts & Modality.VIDEO_WITH_AUDIO and self.supports_native_video:
            return False
        # If model only accepts IMAGE or VIDEO (not native), need frames
        return bool(self.accepts & (Modality.IMAGE | Modality.VIDEO))

    def should_separate_audio(self, bundle: ContentBundle) -> bool:
        """Determine if audio separation from video is needed."""
        if not bundle.has_video:
            return False
        # If model accepts VIDEO_WITH_AUDIO natively, no separation needed
        if self.accepts & Modality.VIDEO_WITH_AUDIO and self.supports_native_video:
            return False
        # If model accepts AUDIO separately, extract it
        return bool(self.accepts & Modality.AUDIO)

    def best_input_strategy(self, bundle: ContentBundle) -> InputStrategy:
        """Determine the optimal input strategy for this bundle + model combo."""
        if bundle.content_type == "article":
            return InputStrategy.TEXT_ONLY
        if bundle.content_type == "image":
            return InputStrategy.IMAGE_ONLY
        if bundle.content_type == "audio":
            if self.accepts & Modality.AUDIO:
                return InputStrategy.AUDIO_ONLY
            return InputStrategy.TRANSCRIBE_THEN_TEXT

        # Video content — the interesting part
        if bundle.content_type == "video":
            # Best case: model can handle video+audio natively
            if (self.accepts & Modality.VIDEO_WITH_AUDIO
                    and self.supports_native_video):
                return InputStrategy.NATIVE_VIDEO_AUDIO

            # Model can handle video natively but not audio
            if self.accepts & Modality.VIDEO and self.supports_native_video:
                if self.accepts & Modality.AUDIO:
                    return InputStrategy.VIDEO_NATIVE_PLUS_AUDIO_SEPARATE
                return InputStrategy.VIDEO_NATIVE_ONLY

            # Model needs frames extracted
            if self.accepts & (Modality.IMAGE | Modality.VIDEO):
                if self.accepts & Modality.AUDIO:
                    return InputStrategy.FRAMES_PLUS_AUDIO
                return InputStrategy.FRAMES_ONLY

            # Fallback: transcribe to text
            return InputStrategy.TRANSCRIBE_THEN_TEXT

        return InputStrategy.TEXT_ONLY


class InputStrategy(Enum):
    """How the pipeline should feed input to a model.

    This is the output of the capability matching logic.
    Each strategy maps to a concrete code path in the pipeline.
    """

    # Video strategies (ordered by quality)
    NATIVE_VIDEO_AUDIO = "native_video_audio"  # Pass video file, model handles both
    VIDEO_NATIVE_PLUS_AUDIO_SEPARATE = "video_native_plus_audio"  # Video native + audio extracted
    VIDEO_NATIVE_ONLY = "video_native_only"  # Video native, ignore audio
    FRAMES_PLUS_AUDIO = "frames_plus_audio"  # Extracted frames + separated audio
    FRAMES_ONLY = "frames_only"  # Extracted frames only, no audio

    # Single-modality strategies
    IMAGE_ONLY = "image_only"
    AUDIO_ONLY = "audio_only"
    TEXT_ONLY = "text_only"

    # Fallback strategies
    TRANSCRIBE_THEN_TEXT = "transcribe_then_text"  # Audio → transcript → text model


