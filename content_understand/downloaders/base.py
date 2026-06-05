"""Abstract base for content downloaders."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class VideoInfo:
    """Metadata about a video/content."""

    url: str
    title: str = ""
    author: str = ""
    duration: int = 0
    description: str = ""
    upload_date: str = ""
    platform: str = "unknown"
    filesize: int = 0
    format: str = ""
    subtitles: list[str] = field(default_factory=list)
    direct_url: str = ""
    local_path: str = ""


class Downloader(ABC):
    """Abstract content downloader."""

    @abstractmethod
    def can_handle(self, url: str) -> bool:
        """Return True if this downloader can handle the given URL."""

    @abstractmethod
    def get_info(self, url: str) -> VideoInfo:
        """Fetch metadata without downloading."""

    @abstractmethod
    def download(self, url: str, output_path: str) -> str:
        """Download content to output_path. Returns the local file path."""

    def extract_subtitles(self, url: str, languages: str = "zh-CN,en") -> str | None:
        """Extract subtitles as plain text. Override if supported."""
        return None
