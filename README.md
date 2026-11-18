# AutumnMark · 秋笺官网

官网由 GitHub Pages 直接发布本分支的根目录。首页使用静态 HTML、CSS 和 JavaScript，无需构建。

- 本地预览可在本目录运行 `python -m http.server 4173`，然后访问 `http://localhost:4173/`。
- `assets/editor-*.webp` 是 AutumnMark v0.24.5 的实拍界面。替换截图时同步更新首页的截图说明、尺寸和分享图地址。
- 下载区域从 GitHub Releases 读取最新正式版的安装包。接口暂时不可用时，下载区会显示 `release-fallback.json` 中的版本和安装包。每次发布正式版后可用 Releases API 核对并更新这个文件中的版本号和六个安装包链接。
