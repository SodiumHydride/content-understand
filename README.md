# Content Understand

Desktop app for **multimodal content understanding** and **local Markdown wiki**.

Feed it a video, image, audio, or article URL — it understands the content and writes a structured wiki page to your local vault.

- **UI**: Electron + React + Tailwind — bilingual (zh/en)
- **Engine**: Python sidecar — fetch → multimodal understand → wiki write
- **Models**: Gemma 4 QAT (local), MiMo, Gemini, Claude, OpenAI-compatible
- **Storage**: Markdown wiki in app userData, export anytime

## Quick start

```bash
npm install
pip install -r requirements.txt
npm run dev
```

Electron spawns the Python sidecar automatically. No extra setup needed.

## Features

- **Video understanding**: automatic 30s segmentation, frame extraction, audio transcription, structured wiki output
- **Multimodal**: video, image, audio, article — one app handles all
- **Local-first**: Gemma 4 12B QAT runs entirely on your machine (7.2 GB, 12+ GB RAM)
- **Wiki output**: YAML frontmatter + timeline + key points + detailed content (Obsidian-compatible)
- **Bilibili / YouTube**: built-in video download via yt-dlp

## Recommended model: Gemma 4 12B QAT

The best local model for this app. Install via Settings → Ollama → Pull.

- **7.2 GB** download, Q4 quantization with near-BF16 quality
- **Encoder-free**: native video + audio + image in a single model
- **Auto-segmentation**: long videos split into 30s chunks, processed sequentially
- **256K context**: handles long-form content

## Project layout

```
content_understand/    # Multimodal understanding engine
  pipeline.py          # ContentPipeline — resolve → extract → understand → output
  models/              # AI backends: Gemma 4, MiMo, Gemini, Claude, OpenAI-compat
  resolvers/           # URL/file resolution: yt-dlp, HTTP, local, search engine
  extractors/          # HTML (trafilatura) + PDF (PyMuPDF) text extraction
  preprocessing.py     # FFmpeg video normalization + frame extraction
engine/                # App-specific engine bridge + runtime
  understand/          # Orchestration: app config → engine pipeline
  write/               # Markdown vault writer (wiki format)
  runtime/             # Ollama lifecycle + preset catalog + ffmpeg download
sidecar/               # HTTP API for Electron (FastAPI, port 17890)
src/                   # Electron + React frontend
```

## Build & distribute

```bash
# Development
npm run dev

# Package sidecar (PyInstaller)
npm run build:sidecar

# Package Electron app
npm run dist:mac     # → dist/*.dmg
npm run dist:win     # → dist/*.exe (run on Windows)

# Or push a tag to trigger GitHub Actions CI
git tag v0.1.0 && git push --tags
```

### What users need

| Component | How it's handled |
|-----------|-----------------|
| Ollama | Downloaded automatically on first launch |
| ffmpeg | Downloaded automatically on first video |
| Gemma 4 model | Pull once via Settings → Ollama |

## Models

| Backend | Use case |
|---------|----------|
| **Gemma 4 QAT** | Local inference — video, image, audio, article (recommended) |
| **OpenAI-compatible** | OpenRouter, DeepSeek, Moonshot, custom endpoint |
| **MiMo** | Xiaomi's multimodal model — native API |
| **Gemini** | Audio — Google AI Studio |
| **Claude** | Image — Anthropic Messages API |

## Export

- **Single note**: reader toolbar → Export Markdown
- **Whole vault**: Settings → Notes folder → Export all Markdown

## License

MIT
