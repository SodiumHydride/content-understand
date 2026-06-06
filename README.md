# Content Understand

Desktop app for multimodal **content understanding** and **local Markdown storage**.

- **UI**: Electron + React + Tailwind — bilingual (zh/en)
- **Engine**: bundled Python engine — fetch (yt-dlp / HTTP) → multimodal understand → vault write
- **Storage**: Wiki lives under **app userData** (not a user-picked `C:` / `D:` path). Export `.md` anytime.

## Quick start

```bash
npm install
npm run dev
```

Electron spawns the sidecar automatically. No extra engine install needed.

### Manual sidecar (dev)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export CONTENT_APP_DATA="$HOME/.content-understand"
python3 sidecar/server.py --port 17890
```

## Project layout

```
content_understand/    # Multimodal understanding engine (bundled)
  pipeline.py          # ContentPipeline — resolve → extract → understand → output
  models/              # AI backends: MiMo, Gemini, Claude, OpenAI-compat
  resolvers/           # URL/file resolution: yt-dlp, HTTP, local, search engine
  extractors/          # HTML (trafilatura) + PDF (PyMuPDF) text extraction
  preprocessors/       # FFmpeg video normalization + base64 encoding
  output/              # Markdown + JSON writers
engine/                # App-specific engine bridge + runtime
  paths.py             # App-internal directories
  fetch/               # yt-dlp (video), HTTP (image/audio)
  understand/          # Orchestration: app config → engine pipeline
  write/               # Markdown vault writer
  index/               # SQLite cache over vault
  runtime/             # Ollama lifecycle + curated preset catalog
sidecar/               # HTTP API for Electron (FastAPI, port 17890)
src/                   # Electron + React frontend
```

## Models (settings)

Per modality (video / image / audio / article):

| Backend | Use case |
|---------|----------|
| **Cloud OpenAI-compatible** | OpenRouter, DeepSeek, Moonshot, custom endpoint + API key |
| **Local Ollama (presets)** | App-managed or system Ollama — **catalog presets only** |
| **MiMo** | Video, image, audio, article — native API |
| **Gemini** | Audio — Google AI Studio (up to 9.5h) |
| **Claude** | Image — Anthropic Messages API |

### Local runtime (Ollama)

Two instances, cleanly separated:

| Instance | Port | Binary | Models | Uninstall |
|----------|------|--------|--------|-----------|
| **App Ollama** | 11435 | `{appData}/runtime/ollama/` | `{appData}/models/` | Removed with "Delete all data" |
| **System Ollama** | 11434 | User install (PATH) | User's `~/.ollama` | Never removed by the app |

The app downloads Ollama into its own storage when needed. Presets in `engine/runtime/presets.json` map to `ollama pull` targets (Qwen2.5-VL, Gemma 4, MiniCPM-V, etc.). Only catalog models can be pulled, selected, or deleted from the UI.

Settings → Models:

1. **Download app Ollama** (one-time, into app data)
2. Pick a **hardware-recommended preset**
3. **Pull** the preset model
4. Set inference mode to prefer local / local only

If the user already runs system Ollama, enable **Prefer system Ollama** — the app connects to port 11434 and still only exposes catalog models for pull/delete/select.

## Export

- **Single note**: reader toolbar → Export Markdown
- **Whole vault**: Settings → Notes folder → Export all Markdown

## Out of scope (for now)

Search, Q&A, wikilinks, knowledge graph engine.
