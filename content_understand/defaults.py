"""Single source of truth for all default model names, API endpoints, and ports.

Every module that needs a default value should import from here instead of
hardcoding strings.  This makes it trivial to update a default globally and
prevents the same string from drifting across files.
"""

from __future__ import annotations

# ── Sidecar port (shared between Python sidecar and Electron main process) ──
SIDECAR_PORT = 17890

# ── Ollama ──
# User/system Ollama (if installed separately) listens here by default.
OLLAMA_USER_PORT = 11434
OLLAMA_USER_BASE_URL = f"http://127.0.0.1:{OLLAMA_USER_PORT}"
# App-managed Ollama uses a dedicated port to avoid clashing with the user's daemon.
OLLAMA_APP_PORT = 11435
OLLAMA_APP_BASE_URL = f"http://127.0.0.1:{OLLAMA_APP_PORT}"
# Back-compat alias for OpenAI-compat base construction.
OLLAMA_BASE_URL = OLLAMA_USER_BASE_URL

# ── Model defaults per backend ─────────────────────────────────────────────
# Each tuple is (video_model, image_model, audio_model, article_model).
# Use the appropriate element when constructing a backend config.

MIMO_DEFAULT_MODEL = "mimo-v2.5"
MIMO_DEFAULT_MODEL_PRO = "mimo-v2.5-pro"
MIMO_API_BASE = "https://api.xiaomimimo.com/v1"

GEMINI_DEFAULT_MODEL = "gemini-2.5-flash"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

CLAUDE_DEFAULT_MODEL = "claude-sonnet-4-6"
CLAUDE_API_BASE = "https://api.anthropic.com"

OPENAI_COMPAT_DEFAULT_MODEL = "gpt-4o-mini"

LOCAL_SERVER_DEFAULT_MODEL = ""

# ── Whisper ──
WHISPER_DEFAULT_MODEL = "large-v3"

# ── Download quality defaults ──────────────────────────────────────────────
VIDEO_QUALITY_DEFAULT = 720  # pixels height cap
BILIBILI_QUALITY_DEFAULT = 360  # pixels height cap
