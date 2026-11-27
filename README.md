<p align="center"><img src="docs/assets/logo-small.png" alt="AutumnMark 秋笺" width="80" height="80"></p>

<h1 align="center">AutumnMark · 秋笺</h1>

<p align="center">开源桌面 Markdown 编辑器——图文与手绘单文件保存，扩展语法优雅回退。</p>

<p align="center">
  <a href="https://autumn-one.github.io/autumnmark/">访问官网</a> ·
  <a href="https://github.com/Autumn-one/autumnmark/releases/latest">下载正式版</a> ·
  <a href="https://github.com/Autumn-one/autumnmark/releases">发布记录</a> ·
  <a href="docs/examples/ridge-notes.md">示例文档</a>
</p>

![秋笺「松风明月」主题编辑《雾岭山脊 · 踏秋观测手记》：左侧是文件、大纲与 AI 侧边栏，正文顶部展示多选项卡、单文件内嵌海拔剖面图与折叠块。](docs/assets/autumnmark-pine-ink-2x.webp)

![同一份手记下方的内嵌 Excalidraw 手绘图与增强代码块：手绘图直接内嵌在 Markdown 中并支持点击二次编辑，代码块展示居中文件名 ridge_metrics.py、第 2-4 行高亮与可展开预览。](docs/assets/autumnmark-drawing-code-2x.webp)

<p align="center">
  <a href="docs/examples/ridge-notes.md">查看截图中的示例 Markdown</a> ·
  <a href="https://autumn-one.github.io/autumnmark/#preview">在官网切换浅色、手绘与代码、源码和深色视图</a>
</p>

## 核心特色

- **无需图床的内嵌图片**：粘贴截图、本地图片或网页图片默认直接写入 `.md`，单文件离线可读；支持拖拽调宽、批量内嵌，也可随时右键转为本地图片。
- **内嵌 Excalidraw 手绘图**：输入 `/excalidraw` 直接在文档内绘制流程图与草图，默认单文件内嵌，点击画布随时修改并支持拖拽调宽。
- **可回退的扩展语法**：所有增强均附着在标准标题、HTML 注释、图片链接与代码围栏上，换用其他 Markdown 编辑器打开也不会乱码或丢内容。
- **多选项卡 · 折叠语法 · 代码块增强**：`/tabs` 切换多步骤内容，`/fold` 收起补充说明，代码块支持居中文件名、重点行高亮与可拖拽预览高度。

### 换个编辑器打开同一份 `.md` 会怎样？

| 功能           | 在秋笺里                                       | 在其他 Markdown 编辑器里                                  |
| -------------- | ---------------------------------------------- | --------------------------------------------------------- |
| **内嵌图片**   | 默认内嵌单文件、源码折叠芯片、拖拽调宽         | 支持 `data:` 即可离线看图；遇限制平台可右键转为本地图片   |
| **内嵌手绘图** | 内置 Excalidraw 实时编辑、导出自动渲染高清图   | 标准图片语法（亦支持 `.excalidraw` 引用），不破坏文档结构 |
| **多选项卡**   | 点击标签切换不同平台步骤或节点记录             | 每个标签按普通标题（`#### \| 标题`）依次展示全部内容      |
| **折叠语法**   | 点击标题收起或展开补充说明，导出 HTML 仍可交互 | HTML 注释自动隐藏，标题与正文按原顺序完整可读             |
| **代码块增强** | 顶栏居中文件名、重点行高亮、可调预览高度       | 仍是标准围栏代码块，完整保留高亮与源码复制                |

## 快速上手扩展语法

### 多选项卡

输入 `/tabs` 插入选项卡组，用 `+` 添加标签；也可直接编写标准 Markdown，组内以 `| ` 开头的标题即为标签名：

```markdown
<!-- tabs -->

#### | 杉林口 · 720m

**06:40 · 晨雾初散**　林间能见度约五十米，松针上的露珠尚未落下。

#### | 听风垭 · 1160m

**07:25 · 雾线交汇**　东坡的雾沿着垭口倾泻下沉，西侧山脊已经见光。

<!-- /tabs -->
```

### 折叠语法

输入 `/fold`（或 `/折叠`），用两行 HTML 注释包住标题与正文；如需默认展开，开头改写为 `<!-- fold open -->`：

```markdown
<!-- fold -->

### 为什么要在听风垭多停十分钟？

东西两侧坡面的气流在此交汇。每分钟拍一张照片，就能看出雾线抬升与回落的方向。

<!-- /fold -->
```

### 代码块增强

在代码围栏首行写 `title="文件名"`、`{2-4}` 高亮行与 `max-lines=5` 预览行数，也可直接拖拽代码块底边调整高度：

````markdown
```python title="ridge_metrics.py" {2-4} max-lines=5
elevations = [720, 1160, 1380]
start, summit = elevations[0], elevations[-1]
gain = summit - start
temp_drop = round(gain / 100 * 0.6, 1)

print(f"累计爬升 +{gain} m，山顶约降温 {temp_drop} °C")
```
````

[完整扩展语法文档](https://github.com/Autumn-one/autumnmark/blob/develop/packages/website/content/docs/end-user/MARKDOWN_SYNTAX.md#content-tabs) · [图片与媒体内嵌指南](https://github.com/Autumn-one/autumnmark/blob/develop/packages/website/content/docs/end-user/IMAGES.md#embed-in-markdown-base64)

## 更多桌面端体验

- **主题与外观**：默认内置「松风明月」浅色与「暮紫日记」深色主题，支持在线主题库与自定义 CSS 工坊。
- **完整写作工具链**：CommonMark & GFM、KaTeX 数学公式、Mermaid / PlantUML 图表、表格拖拽调宽与排序、专注/打字机/阅读模式、文档 AI 侧边栏，以及 HTML / PDF 导出。

## 下载与本地开发

正式版提供 **Windows x64**（安装程序、便携 ZIP / 7z）、**macOS ARM64（Apple 芯片）** 与 **Linux x64** 安装包。[前往 Releases 下载](https://github.com/Autumn-one/autumnmark/releases/latest)

```bash
pnpm install        # 安装依赖
pnpm run dev        # 启动桌面端开发模式
pnpm run build:win:x64  # 构建 Windows x64 安装包
```

开发规范与贡献方式见 [贡献指南](.github/CONTRIBUTING.md)。

## 上游与许可

秋笺基于 MarkText 构建，感谢上游作者与社区贡献者。项目采用 MIT 许可证。[MarkText](https://github.com/marktext/marktext) · [上游贡献者](https://github.com/marktext/marktext/graphs/contributors) · [上游 README 译本](docs/i18n/) · [MIT 许可证](LICENSE)

<details>
<summary>MarkText 上游赞助信息</summary>

**Special Sponsor**

<table>
<tr>
<td width="182"><a href="https://serpapi.com/?utm_source=marktext"><img src="docs/assets/sponsors/serpapi.png" width="150"></a></td>
<td align="left"><a href="https://serpapi.com/?utm_source=marktext">Scrape Google and other search engines from our fast, easy, and complete API.</a></td>
</tr>
</table>

<!-- current-sponsors:start -->

**Current Public Sponsors (1)**

[![Current public sponsors](docs/assets/sponsors/current.svg)](https://github.com/sponsors/marktext)

Only active, public GitHub sponsors are listed here. Thank you to our private sponsors as well.

<!-- current-sponsors:end -->

</details>
