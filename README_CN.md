# Content Understand

多模态内容理解 + 本地 Markdown Wiki 桌面应用。

输入视频、图片、音频或文章 URL —— 自动理解内容，生成结构化 wiki 页面写入本地知识库。

- **界面**：Electron + React + Tailwind —— 中英双语
- **引擎**：Python sidecar —— 抓取 → 多模态理解 → wiki 输出
- **模型**：Gemma 4 QAT（本地）、MiMo、Gemini、Claude、OpenAI 兼容
- **存储**：Markdown wiki 存在 app userData，随时导出

## 快速开始

```bash
npm install
pip install -r requirements.txt
npm run dev
```

Electron 自动启动 Python sidecar，无需额外配置。

## 功能

- **视频理解**：自动 30 秒分段、抽帧、音频转录、结构化 wiki 输出
- **多模态**：视频、图片、音频、文章 —— 一个应用搞定
- **本地优先**：Gemma 4 12B QAT 完全本地运行（7.2 GB，需 12+ GB 内存）
- **Wiki 输出**：YAML frontmatter + 时间线 + 要点 + 详细内容（兼容 Obsidian）
- **B 站 / YouTube**：内置 yt-dlp 视频下载

## 推荐模型：Gemma 4 12B QAT

本应用最佳本地模型。在 Settings → Ollama → Pull 安装。

- **7.2 GB** 下载，Q4 量化，接近 BF16 原始质量
- **Encoder-free 架构**：原生视频 + 音频 + 图像，单一模型搞定
- **自动分段**：长视频切成 30 秒小段，串行处理后合并
- **256K 上下文**：支持长内容

## 项目结构

```
content_understand/    # 多模态理解引擎
  pipeline.py          # ContentPipeline —— 解析 → 提取 → 理解 → 输出
  models/              # AI 后端：Gemma 4、MiMo、Gemini、Claude、OpenAI 兼容
  resolvers/           # URL/文件解析：yt-dlp、HTTP、本地、搜索引擎
  extractors/          # HTML (trafilatura) + PDF (PyMuPDF) 文本提取
  preprocessing.py     # FFmpeg 视频标准化 + 帧提取
engine/                # 应用专用引擎桥接 + 运行时
  understand/          # 编排：应用配置 → 引擎 pipeline
  write/               # Markdown vault 写入器（wiki 格式）
  runtime/             # Ollama 生命周期 + 预设目录 + ffmpeg 下载
sidecar/               # Electron HTTP API (FastAPI, 端口 17890)
src/                   # Electron + React 前端
```

## 打包与分发

```bash
# 开发
npm run dev

# 打包 sidecar（PyInstaller）
npm run build:sidecar

# 打包 Electron 应用
npm run dist:mac     # → dist/*.dmg
npm run dist:win     # → dist/*.exe（需在 Windows 上执行）

# 或者推送 tag 触发 GitHub Actions 自动构建
git tag v0.1.0 && git push --tags
```

### 用户需要什么

| 组件 | 处理方式 |
|------|---------|
| Ollama | 首次启动自动下载 |
| ffmpeg | 首次处理视频自动下载 |
| Gemma 4 模型 | 在 Settings → Ollama 点一下 Pull |

## 模型支持

| 后端 | 用途 |
|------|------|
| **Gemma 4 QAT** | 本地推理 —— 视频、图片、音频、文章（推荐） |
| **OpenAI 兼容** | OpenRouter、DeepSeek、Moonshot、自定义端点 |
| **MiMo** | 小米多模态模型 —— 原生 API |
| **Gemini** | 音频 —— Google AI Studio |
| **Claude** | 图片 —— Anthropic Messages API |

## 导出

- **单篇笔记**：阅读器工具栏 → Export Markdown
- **整个知识库**：Settings → Notes folder → Export all Markdown

## 许可证

MIT
