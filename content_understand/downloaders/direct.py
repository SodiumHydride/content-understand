"""Direct HTTP downloader (fallback for any URL)."""

from __future__ import annotations

import logging
import os
from typing import Any

import requests

from content_understand.downloaders.base import Downloader, VideoInfo

logger = logging.getLogger(__name__)


class DirectDownloader(Downloader):
    """Download any file via direct HTTP GET."""

    def can_handle(self, url: str) -> bool:
        return url.startswith(("http://", "https://"))

    def get_info(self, url: str) -> VideoInfo:
        r = requests.head(url, timeout=10, allow_redirects=True, headers={
            "User-Agent": "Mozilla/5.0 (compatible; content-understand/1.0)",
        })
        return VideoInfo(
            url=url,
            title=url.split("/")[-1][:100] or "file",
            filesize=int(r.headers.get("content-length", 0)),
            format=r.headers.get("content-type", ""),
        )

    def download(self, url: str, output_path: str) -> str:
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

        r = requests.get(
            url,
            timeout=300,
            stream=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; content-understand/1.0)"},
        )
        r.raise_for_status()

        with open(output_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                f.write(chunk)

        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            return output_path
        raise RuntimeError(f"Downloaded file is empty: {output_path}")
