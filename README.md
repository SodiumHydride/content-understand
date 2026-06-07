# Content Understand

Desktop app for **multimodal content understanding** — feed it a video, image, audio, or article URL, get a structured wiki page in your local vault.

- Electron + React + Tailwind (zh/en)
- Local-first: Gemma 4 12B QAT runs entirely on your machine
- Wiki output with timeline, key points, and detailed content

## Quick start

```bash
npm install
pip install -r requirements.txt
npm run dev
```

## Build

```bash
npm run dist:mac     # macOS .dmg
npm run dist:win     # Windows .exe (run on Windows)
```

Push a `v*` tag to trigger GitHub Actions CI for both platforms.

## TODO

- [ ] Search & Q&A over vault
- [ ] Wikilinks & knowledge graph
- [ ] Multi-model comparison (run same content through 2+ backends)
- [ ] Batch processing (playlist / channel ingest)
- [ ] Audio-only podcast mode
- [ ] Image OCR + diagram understanding
- [ ] Plugin system for custom post-processing
- [ ] Mobile companion (read vault on phone)

## License

MIT
