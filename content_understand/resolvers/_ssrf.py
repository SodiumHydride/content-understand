"""SSRF protection utility — blocks requests to private/internal addresses."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


def validate_url_not_ssrf(url: str) -> None:
    """Reject URLs that resolve to private, loopback, link-local, or reserved IPs.

    Raises ValueError if the URL targets an internal address.
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

    seen: set[str] = set()
    for _family, _type, _proto, _canonname, sockaddr in addrinfos:
        ip_str = sockaddr[0]
        if ip_str in seen:
            continue
        seen.add(ip_str)

        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError as exc:
            raise ValueError(f"Invalid IP address {ip_str!r} for hostname {hostname!r}") from exc

        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError(
                f"URL resolves to a private/internal IP address ({ip_str}) — SSRF blocked"
            )
