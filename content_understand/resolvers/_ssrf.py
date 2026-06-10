"""SSRF protection — connection-level IP validation, redirect interception, download size limits.

Replaces the old TOCTOU-vulnerable DNS-first check with a urllib3 connection
that validates the resolved IP at TCP connect time.  Redirects are followed
manually with IP re-validation at every hop.  Streaming downloads are capped
at a configurable byte limit.
"""

from __future__ import annotations

import ipaddress
import socket
from typing import Any
from urllib.parse import urlparse

import requests
import urllib3

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PRIVATE_NETS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("::ffff:0:0/96"),  # IPv4-mapped IPv6
)

DEFAULT_MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2 GiB


def _is_private_ip(ip_str: str) -> bool:
    """Return True if the IP string belongs to a private / internal range."""
    ip = ipaddress.ip_address(ip_str)
    # IPv4-mapped IPv6 (::ffff:x.x.x.x) — check the mapped IPv4 address
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return _is_private_ip(str(ip.ipv4_mapped))
    # 6to4 (::202:xxxx:xxxx) — check the embedded IPv4
    if isinstance(ip, ipaddress.IPv6Address) and ip.sixtofour is not None:
        return _is_private_ip(str(ip.sixtofour))
    return any(ip in net for net in _PRIVATE_NETS) or ip.is_reserved


def _check_addrinfos(addrinfos: list[tuple], hostname: str) -> None:
    """Raise ValueError if *any* resolved address is private / internal."""
    seen: set[str] = set()
    for _family, _type, _proto, _canonname, sockaddr in addrinfos:
        ip_str = sockaddr[0]
        if ip_str in seen:
            continue
        seen.add(ip_str)
        if _is_private_ip(ip_str):
            raise ValueError(
                f"URL resolves to a private/internal IP address ({ip_str}) — SSRF blocked"
            )


def _safe_connect(
    address: tuple[str, int],
    timeout: float | None = None,
    source_address: tuple[str, int] | None = None,
    socket_options: list[tuple[int, int, int | bytes]] | None = None,
) -> socket.socket:
    """Drop-in replacement for urllib3's create_connection that blocks private IPs."""
    host, port = address
    # Step 1: Resolve once
    try:
        addrinfos = socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise OSError(f"Cannot resolve host {host!r}: {exc}") from exc
    if not addrinfos:
        raise OSError(f"getaddrinfo returned empty list for {host!r}")

    # Step 2: Validate ALL resolved IPs
    _check_addrinfos(addrinfos, host)

    # Step 3: Connect directly to the first validated sockaddr (no second DNS lookup)
    errors: list[Exception] = []
    for family, _type, _proto, _canonname, sockaddr in addrinfos:
        ip_str = sockaddr[0]
        # Defense in depth: validate again right before connect
        if _is_private_ip(ip_str):
            continue  # Skip this address, try next
        sock = socket.socket(family, socket.SOCK_STREAM)
        if timeout is not None:
            sock.settimeout(timeout)
        if source_address is not None:
            sock.bind(source_address)
        if socket_options is not None:
            for opt in socket_options:
                sock.setsockopt(*opt)
        try:
            sock.connect(sockaddr)
            return sock
        except OSError as exc:
            sock.close()
            errors.append(exc)
    if errors:
        raise OSError(f"Could not connect to {host!r}: {errors[-1]}") from errors[-1]
    raise OSError(f"All resolved addresses for {host!r} are private/internal — SSRF blocked")


# Monkey-patch urllib3 so every connection through requests goes through our check.
# This is done at module import time so it is always active.
urllib3.util.connection.create_connection = _safe_connect  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Redirect-safe Session
# ---------------------------------------------------------------------------


class SafeSession(requests.Session):
    """requests.Session with SSRF protection baked in.

    * Connection-level IP validation via patched ``create_connection``.
    * Manual redirect following with per-hop IP re-validation.
    * Streaming download size cap.
    """

    def __init__(self, max_download_bytes: int = DEFAULT_MAX_DOWNLOAD_BYTES) -> None:
        super().__init__()
        self.max_download_bytes = max_download_bytes
        # Disable automatic redirect following — we handle it ourselves.
        self.max_redirects = 0  # type: ignore[assignment]

    # ---- redirect handling --------------------------------------------------

    def request(  # type: override
        self,
        method: str,
        url: str,
        *,
        stream: bool = False,
        max_redirects: int = 0,
        **kwargs: Any,
    ) -> requests.Response:
        """Send request and manually follow redirects with per-hop IP validation."""
        kwargs.setdefault("allow_redirects", False)
        resp = super().request(method, url, stream=stream, **kwargs)

        hops = 0
        max_hops = kwargs.pop("_max_redirect_hops", 20)
        while resp.is_redirect and resp.headers.get("location"):
            hops += 1
            if hops > max_hops:
                raise requests.TooManyRedirects(
                    f"Exceeded {max_hops} redirect hops (SSRF safety limit)"
                )
            location = resp.headers["location"]
            # Close previous response to free the connection
            resp.close()
            # Resolve relative redirect URL
            next_url = _resolve_redirect(url, location)
            # Validate destination (connection-level check happens at TCP time,
            # but we also do a quick DNS pre-check to fail fast).
            _precheck_url(next_url)
            url = next_url
            resp = super().request(method, url, stream=stream, **kwargs)

        return resp

    # ---- streaming download with size cap -----------------------------------

    def stream_download(
        self, url: str, dest: str | None = None, **kwargs: Any
    ) -> requests.Response:
        """Convenience: GET with ``stream=True`` and enforce download size limit.

        If *dest* is given the body is written to that path (chunk_size=8192).
        Otherwise the caller is responsible for consuming ``response.iter_content``
        via :meth:`safe_iter_content`.
        """
        resp = self.get(url, stream=True, **kwargs)
        resp.raise_for_status()
        if dest is not None:
            _write_stream(resp, dest, self.max_download_bytes)
        return resp

    def safe_iter_content(self, resp: requests.Response, chunk_size: int = 8192):
        """Yield chunks from a streaming response, enforcing the download size limit."""
        total = 0
        for chunk in resp.iter_content(chunk_size=chunk_size):
            total += len(chunk)
            if total > self.max_download_bytes:
                resp.close()
                raise ValueError(
                    f"Download exceeded size limit of {self.max_download_bytes} bytes "
                    f"(got at least {total} bytes)"
                )
            yield chunk


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_safe_session(max_download_bytes: int = DEFAULT_MAX_DOWNLOAD_BYTES) -> SafeSession:
    """Create a :class:`SafeSession` with the given download size limit."""
    return SafeSession(max_download_bytes=max_download_bytes)


# ---------------------------------------------------------------------------
# Backward-compatible public API
# ---------------------------------------------------------------------------


def validate_url_not_ssrf(url: str) -> None:
    """Reject URLs that resolve to private, loopback, link-local, or reserved IPs.

    This is the legacy interface kept for backward compatibility.
    Callers should migrate to :func:`create_safe_session` for full protection.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"URL scheme must be http or https, got: {parsed.scheme!r}")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL has no hostname")

    try:
        addrinfos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise ValueError(f"Cannot resolve hostname {hostname!r}: {exc}") from exc

    _check_addrinfos(addrinfos, hostname)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolve_redirect(base_url: str, location: str) -> str:
    """Resolve a possibly-relative *location* against *base_url*."""
    if location.startswith(("http://", "https://")):
        return location
    parsed = urlparse(base_url)
    if location.startswith("//"):
        return f"{parsed.scheme}:{location}"
    if location.startswith("/"):
        return f"{parsed.scheme}://{parsed.netloc}{location}"
    # Relative path
    base_path = parsed.path.rsplit("/", 1)[0]
    return f"{parsed.scheme}://{parsed.netloc}{base_path}/{location}"


def _precheck_url(url: str) -> None:
    """Fast DNS pre-check before following a redirect (connection check is the real guard)."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Redirect target scheme must be http or https, got: {parsed.scheme!r}")
    hostname = parsed.hostname
    if not hostname:
        raise ValueError(f"Redirect target has no hostname: {url}")
    try:
        addrinfos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise ValueError(f"Cannot resolve redirect hostname {hostname!r}: {exc}") from exc
    _check_addrinfos(addrinfos, hostname)


def _write_stream(resp: requests.Response, dest: str, max_bytes: int) -> None:
    """Write a streaming response to *dest* with size limit, chunk_size=8192."""
    total = 0
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            total += len(chunk)
            if total > max_bytes:
                resp.close()
                raise ValueError(
                    f"Download exceeded size limit of {max_bytes} bytes "
                    f"(wrote at least {total} bytes)"
                )
            f.write(chunk)
