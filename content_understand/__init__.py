"""Content Understand Engine — multimodal content understanding pipeline.

Supports video, image, audio, and article content types with pluggable
model backends (MiMo, Gemini, Claude, OpenAI-compatible, local servers).
"""

__version__ = "0.1.0"

from content_understand.config import BackendConfig, ContentConfig
from content_understand.pipeline import ContentPipeline

__all__ = [
    "BackendConfig",
    "ContentConfig",
    "ContentPipeline",
    "__version__",
]
