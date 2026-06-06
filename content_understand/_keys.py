"""Shared API key rotation helper for model backends.

Provides:
- KeyRotator: LRU key selection with 429 cooldown tracking
- rotate_request(): tenacity-backed retry with exponential backoff
- RateLimitError: raised on 429 to trigger tenacity retry
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import requests
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

logger = logging.getLogger(__name__)


class RateLimitError(Exception):
    """Raised when API returns 429, triggers tenacity retry."""


@dataclass
class KeyState:
    key: str
    last_used: float = 0.0
    cooldown_until: float = 0.0


class KeyRotator:
    """LRU key selector with 429 cooldown tracking.

    Picks the least-recently-used key that is not in cooldown.
    If all keys are cooling down, returns the one with the earliest expiry
    and the wait duration.
    """

    def __init__(self, keys: list[str]):
        self._states = [KeyState(key=k) for k in keys]
        self._lock = threading.Lock()

    @property
    def keys(self) -> list[str]:
        return [s.key for s in self._states]

    def pick(self) -> tuple[KeyState, float]:
        """Return (best key state, seconds to wait). 429-cooled keys skipped."""
        now = time.monotonic()
        with self._lock:
            available = [s for s in self._states if s.cooldown_until <= now]
            if available:
                best = min(available, key=lambda s: s.last_used)
                return best, 0.0
            best = min(self._states, key=lambda s: s.cooldown_until)
            return best, max(0.0, best.cooldown_until - now)

    def mark_success(self, state: KeyState):
        with self._lock:
            state.last_used = time.monotonic()
            state.cooldown_until = 0.0

    def mark_rate_limited(self, state: KeyState, retry_after: float = 60.0):
        with self._lock:
            state.cooldown_until = time.monotonic() + retry_after


def rotate_request(
    url: str,
    body: dict[str, Any],
    rotator: KeyRotator | list[str],
    timeout: int,
    label: str,
    *,
    max_attempts: int = 5,
    headers_factory: Callable[[str], dict[str, str]] | None = None,
    response_extractor: Callable[[dict], str | None] | None = None,
    url_factory: Callable[[str], str] | None = None,
) -> str:
    """POST to API with key rotation, exponential backoff, and 429 cooldown.

    Args:
        url: Full API endpoint URL (ignored if url_factory is provided).
        body: JSON request body.
        rotator: KeyRotator instance, or list of API key strings (auto-wrapped).
        timeout: Request timeout in seconds.
        label: Label for log messages (e.g. "mimo:video").
        max_attempts: Maximum retry attempts (default 5).
        headers_factory: Optional callable(key) -> dict for custom headers.
            Default uses Authorization: Bearer {key}.
        response_extractor: Optional callable(response_json) -> str | None.
            Default extracts choices[0].message.content or Gemini candidates.
        url_factory: Optional callable(key) -> str to build URL per key
            (e.g. Gemini puts key in query param).

    Returns:
        The extracted text content from the API response.

    Raises:
        RuntimeError: If all attempts exhausted or no content in response.
        RateLimitError: On 429 (caught internally by tenacity for retry).
    """
    if isinstance(rotator, list):
        rotator = KeyRotator(rotator)

    if not rotator.keys:
        raise RuntimeError(f"[{label}] No API keys configured")

    def _default_headers(key: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def _default_extractor(data: dict) -> str | None:
        # OpenAI-compatible format
        if data.get("choices"):
            msg = data["choices"][0].get("message", {})
            content = msg.get("content")
            if not content:
                content = msg.get("reasoning_content")
            return content
        # Gemini native format
        candidates = data.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            texts = [p.get("text", "") for p in parts if "text" in p]
            result = "\n".join(texts).strip()
            if result:
                return result
        return None

    make_headers = headers_factory or _default_headers
    extract = response_extractor or _default_extractor

    @retry(
        retry=retry_if_exception_type((RateLimitError, requests.ConnectionError, requests.Timeout)),
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=1, max=60),
        reraise=True,
    )
    def _attempt() -> str:
        state, wait_secs = rotator.pick()
        if wait_secs > 0:
            logger.info("[%s] All keys cooling down, waiting %.1fs", label, wait_secs)
            time.sleep(wait_secs)
            state, _ = rotator.pick()

        key = state.key
        req_headers = make_headers(key)
        req_url = url_factory(key) if url_factory else url

        try:
            r = requests.post(req_url, json=body, headers=req_headers, timeout=timeout)
        except requests.Timeout:
            logger.warning("[%s] Timeout on key ...%s", label, key[-4:])
            raise
        except requests.ConnectionError:
            logger.warning("[%s] Connection error on key ...%s", label, key[-4:])
            raise

        if r.status_code == 200:
            data = r.json()
            content = extract(data)
            if content:
                rotator.mark_success(state)
                return content
            logger.warning("[%s] Empty response from key ...%s", label, key[-4:])
            raise RuntimeError(f"[{label}] Empty response from API")

        if r.status_code == 429:
            retry_after = _parse_retry_after(r)
            rotator.mark_rate_limited(state, retry_after)
            logger.warning(
                "[%s] 429 rate limit on key ...%s, cooldown %.0fs",
                label, key[-4:], retry_after,
            )
            raise RateLimitError(f"[{label}] 429 rate limit")

        if r.status_code >= 500:
            detail = (r.text or "")[:500]
            logger.error(
                "[%s] HTTP %d on key ...%s: %s",
                label,
                r.status_code,
                key[-4:],
                detail,
            )
            is_local = (
                key == "local"
                or "127.0.0.1" in req_url
                or "localhost" in req_url
            )
            if is_local:
                raise RuntimeError(
                    f"[{label}] HTTP {r.status_code}: {detail or 'server error'}"
                )
            raise requests.ConnectionError(
                f"[{label}] HTTP {r.status_code}: {detail or 'server error'}"
            )

        # 4xx non-429: do not retry
        raise RuntimeError(f"[{label}] HTTP {r.status_code}: {r.text[:300]}")

    return _attempt()


def _parse_retry_after(response: requests.Response) -> float:
    """Parse Retry-After header, default 60s if missing or unparseable."""
    val = response.headers.get("Retry-After")
    if val:
        try:
            return float(val)
        except ValueError:
            pass
    return 60.0
