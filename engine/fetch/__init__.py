"""Optional fetch layer (yt-dlp, HTTP). Install extras: pip install -r requirements.txt[fetch]"""

from engine.fetch.core import fetch_to_cache

__all__ = ["fetch_to_cache"]
