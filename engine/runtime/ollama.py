"""Detect local Ollama and optional model pulls."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def ollama_base_url() -> str:
    return os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")


def detect_ollama(timeout: float = 2.0) -> dict[str, Any]:
    base = ollama_base_url()
    try:
        req = urllib.request.Request(f"{base}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode())
        models = [m.get("name", "") for m in data.get("models", [])]
        return {
            "available": True,
            "base_url": f"{base}/v1",
            "models": models,
            "has_gemma4_12b": any("gemma4" in n and "12" in n for n in models),
        }
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return {"available": False, "base_url": None, "models": []}


def suggest_ollama_pull(preset: dict) -> str | None:
    name = preset.get("ollama_model")
    return f"ollama pull {name}" if name else None
