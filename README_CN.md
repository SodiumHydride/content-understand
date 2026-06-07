# Content Understand

多模态内容理解桌面应用 —— 输入视频、图片、音频或文章 URL，自动生成结构化 wiki 页面到本地知识库。

- Electron + React + Tailwind，中英双语
- 本地优先：Gemma 4 12B QAT 完全本地运行
- Wiki 输出：时间线、要点、详细内容

## 快速开始

```bash
npm install
pip install -r requirements.txt
npm run dev
```

## 打包

```bash
npm run dist:mac     # macOS .dmg
npm run dist:win     # Windows .exe（需在 Windows 上执行）
```

推送 `v*` tag 触发 GitHub Actions 自动构建双平台。

## TODO

- [ ] 知识库搜索 & 问答
- [ ] Wikilinks & 知识图谱
- [ ] 多模型对比（同一内容跑 2+ 后端）
- [ ] 批量处理（播放列表 / 频道摄入）
- [ ] 纯音频播客模式
- [ ] 图片 OCR + 图表理解
- [ ] 自定义后处理插件系统
- [ ] 移动端伴侣（手机阅读知识库）

## 许可证

MIT
