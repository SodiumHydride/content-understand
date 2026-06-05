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
  runtime/             # Local llama.cpp lifecycle (download, launch, health)
sidecar/               # HTTP API for Electron (FastAPI, port 17890)
src/                   # Electron + React frontend
```

## Models (settings)

Per modality (video / image / audio / article):

| Backend | Use case |
|---------|----------|
| **Cloud OpenAI-compatible** | OpenRouter, DeepSeek, Moonshot, custom endpoint + API key |
| **Local OpenAI-compatible** | Ollama, llama.cpp server, LM Studio (`/v1/chat/completions`) |
| **MiMo** | Video, image, audio, article — native API |
| **Gemini** | Audio — Google AI Studio (up to 9.5h) |
| **Claude** | Image — Anthropic Messages API |

Hugging Face one-click weights: planned (`models/` dir reserved under app data).

### Local runtime (llama.cpp, macOS + Windows)

The sidecar can **download official llama.cpp binaries** (release `b9484`) and **curated GGUF presets** into app data, then start `llama-server` automatically.

**Dev tests** (from repo root, with `pip install -r requirements.txt`):

```bash
python3 scripts/test_runtime.py
python3 scripts/test_runtime_full.py --bin-only
python3 scripts/test_platform_assets.py   # mac/win/linux release URLs
python3 scripts/test_runtime_full.py --preset gemma4-e2b-lite
```

## Export

- **Single note**: reader toolbar → Export Markdown
- **Whole vault**: Settings → Notes folder → Export all Markdown

## Out of scope (for now)

Search, Q&A, wikilinks, knowledge graph engine.
