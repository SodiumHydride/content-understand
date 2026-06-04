# Content Understand

Desktop app for multimodal **content understanding** and **local Markdown storage**.

- **UI**: Electron + React + Tailwind — full three-column layout, bilingual (zh/en), settings modal
- **Engine**: Python sidecar (FastAPI) — ingest, vault write, light SQLite index
- **Out of scope (for now)**: search, Q&A, wikilinks, knowledge graph

## Quick start

```bash
# UI
cd /Users/teark/Documents/content-understand
npm install
npm run dev

# Sidecar (separate terminal)
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export CONTENT_VAULT=~/ContentVault
python3 sidecar/server.py --port 17890
```

Electron main process auto-spawns the sidecar when `sidecar/server.py` exists.

## Layout

```
src/renderer/     # Full UI (not MVP-trimmed)
engine/           # Python: write, index
sidecar/          # HTTP API for Electron
```

## Environment

| Variable | Description |
|----------|-------------|
| `CONTENT_VAULT` | Markdown output directory (default `~/ContentVault`) |

## Next integration steps

1. Migrate `sodium-core/shared/video_understand` into `engine/ingest/`
2. Replace `engine/write/markdown.py` with media contract writer
3. Sync sidecar config from UI settings (vault path, API keys)
