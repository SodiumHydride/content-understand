"""Direct HTTP download for images and small media."""

from __future__ import annotations

import uuid
from pathlib import Path
from urllib.parse import urlparse

import requests

_MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024  # 500 MB hard limit


def download_http(url: str, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    r = requests.get(url, timeout=120, stream=True, headers={"User-Agent": "ContentUnderstand/0.1"})
    r.raise_for_status()

    # Check content-length if available
    content_length = r.headers.get("content-length")
    if content_length and int(content_length) > _MAX_DOWNLOAD_BYTES:
        raise RuntimeError(
            f"File too large: {int(content_length) / 1024 / 1024:.0f} MB "
            f"(limit: {_MAX_DOWNLOAD_BYTES / 1024 / 1024:.0f} MB)"
        )

    ext = Path(urlparse(url).path).suffix or ".bin"
    if len(ext) > 8:
        ext = ".bin"
    out = dest_dir / f"{uuid.uuid4().hex}{ext}"

    downloaded = 0
    with open(out, "wb") as f:
        for chunk in r.iter_content(65536):
            if chunk:
                f.write(chunk)
                downloaded += len(chunk)
                if downloaded > _MAX_DOWNLOAD_BYTES:
                    f.close()
                    out.unlink(missing_ok=True)
                    raise RuntimeError(
                        f"Download aborted: exceeded {_MAX_DOWNLOAD_BYTES / 1024 / 1024:.0f} MB limit"
                    )
    return out
