<p align="center"><img src="docs/assets/logo-small.png" alt="AutumnMark" width="100" height="100"></p>

<h1 align="center">AutumnMark · 秋笺</h1>

AutumnMark（秋笺）是基于 [MarkText](https://github.com/marktext/marktext) 的桌面 Markdown 编辑器。Windows 和 Linux 提供 x64 安装包，macOS 提供适用于 Apple 芯片的 ARM64 安装包。可以在可视化编辑与源码编辑之间切换，适合写技术笔记、教程和项目文档。

[下载 AutumnMark 正式版](https://github.com/Autumn-one/autumnmark/releases/latest) · [查看发布说明](https://github.com/Autumn-one/autumnmark/releases) · [MIT 许可证](LICENSE)

## 内容选项卡

把不同平台的安装步骤或不同语言的代码示例放进同一组选项卡。读者点击标签就能切换内容。在编辑器里输入 `/tabs` 插入选项卡组，点击 `+` 添加标签。

```markdown
<!-- tabs -->

#### | Windows

双击安装包，按向导完成安装。

#### | macOS

打开 DMG，将应用拖到「应用程序」。

<!-- /tabs -->
```

开头和结尾的注释各占一行。组内标题的文字以 `| ` 开头时，会创建一个新选项卡。

普通 Markdown 阅读器会按顺序显示所有标题和正文，标题保留 `|`。HTML、PDF 导出和打印会展开全部选项卡。 [完整语法与键盘操作](https://github.com/Autumn-one/autumnmark/blob/v0.24.4/packages/website/content/docs/end-user/MARKDOWN_SYNTAX.md#content-tabs)

## v0.24.4 新增的三项语法

### 折叠块

把练习答案、排查日志和补充说明放到可展开的标题下面。在编辑器中输入 `/折叠` 可以插入。

```markdown
<!-- fold -->

### 查看重试步骤

收到 `429` 时，按 `Retry-After` 指示等待后再请求。

<!-- /fold -->
```

`<!-- fold -->` 默认收起，`<!-- fold open -->` 默认展开。普通 Markdown 阅读器可以直接显示标题和完整正文。HTML 导出可交互展开，PDF 和打印会显示全部正文。

### 代码块标题

在围栏语言后加 `title="request.ts"`，代码块上方会显示文件名或示例名称。教程里的多个代码片段可以各自标明出处。

### 行范围高亮

用 `{2-3,5}` 强调第 2、3、5 行。逗号可以组合单行和范围，范围包含起止行。行号从源码第 1 行开始计。

````markdown
```ts title="request.ts" {2-3,5}
const timeout = 5000
const signal = AbortSignal.timeout(timeout)
const response = await fetch('/api/items', { signal })

console.log(response.status)
```
````

## 开发

从仓库根目录运行 `pnpm install` 安装依赖，再用 `pnpm run dev` 启动桌面端。Windows x64 安装包可用 `pnpm run build:win:x64` 构建。

## 上游资料与致谢

以下网站、安装说明、社区和赞助信息属于 MarkText 上游。

<div align="center">
  <sub>Translations:</sub>
  <a href="docs/i18n/README-zh_cn.md#readme">
    <span>:cn:</span>
  </a>
  <a href="docs/i18n/README-zh_tw.md#readme">
    <span>:taiwan:</span>
  </a>
  <a href="docs/i18n/README-jp.md#readme">
    <span>:jp:</span>
  </a>
  <a href="docs/i18n/README-fr.md#readme">
    <span>:fr:</span>
  </a>
  <a href="docs/i18n/README-tr.md#readme">
    <span>:tr:</span>
  </a>
  <a href="docs/i18n/README-es.md#readme">
    <span>:es:</span>
  </a>
  <a href="docs/i18n/README-pt.md#readme">
    <span>:portugal:</span>
  </a>
  <a href="docs/i18n/README-kr.md#readme">
    <span>:kr:</span>
  </a>
  <a href="docs/i18n/README-bn.md#readme">
    <span>:bangladesh:</span>
  </a>
</div>

<div align="center">
  <sub>This Markdown editor that could. Built with ❤︎ by
    <a href="https://github.com/Jocs">Jocs</a> and
    <a href="https://github.com/marktext/marktext/graphs/contributors">
      contributors
    </a>
    .
  </sub>
</div>

<br />

<h2 align="center">Sponsors</h2>

MarkText is an open-source Markdown editor powered by the support of its community. If MarkText improves your workflow, please consider [sponsoring the project](https://github.com/sponsors/marktext). Thank you to all the sponsors ❤️

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

## Screenshot

![](docs/assets/marktext.png?raw=true)

## Features

- Realtime preview (WYSIWYG) and a clean and simple interface to get a distraction-free writing experience.
- Support [CommonMark Spec](https://spec.commonmark.org), [GitHub Flavored Markdown Spec](https://github.github.com/gfm/) and selective support [Pandoc markdown](https://pandoc.org/MANUAL.html#pandocs-markdown).
- Markdown extensions such as math expressions (KaTeX), front matter and emojis.
- Support paragraphs and inline style shortcuts to improve your writing efficiency.
- Output **HTML** and **PDF** files.
- Various [themes](https://marktext.me/docs/themes): **Cadmium Light**, **Material Dark** etc.
- Various editing modes: **Source Code mode**, **Typewriter mode**, **Focus mode**.
- Paste images directly from clipboard.

## Download and Installation

![platform](https://img.shields.io/static/v1.svg?label=Platform&message=Linux%20x64%2Farm64%20|%20macOS%20x64%2Farm64%20|%20Windows%20x64%2Farm64&style=for-the-badge)

|               ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/mac-pass-sm.png)               |               ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/windows-pass-sm.png)               |              ![](https://raw.githubusercontent.com/wiki/ryanoasis/nerd-fonts/screenshots/v1.0.x/linux-pass-sm.png)              |
| :-----------------------------------------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------: |
| [![Download for macOS](https://img.shields.io/badge/macOS-Download-blue)](https://github.com/marktext/marktext/releases/latest) | [![Download for Windows](https://img.shields.io/badge/Windows-Download-blue)](https://github.com/marktext/marktext/releases/latest) | [![Download for Linux](https://img.shields.io/badge/Linux-Download-blue)](https://github.com/marktext/marktext/releases/latest) |

Want to see new features of the latest version? Please refer to [CHANGELOG](https://marktext.me/docs/changelog).

#### macOS

Requires macOS 13 (Ventura) or later. Universal builds aren't published — pick the matching `arm64` or `x64` installer.

You can either download the latest `marktext-mac-(arm64|x64)-%version%.dmg` from the [release page](https://github.com/marktext/marktext/releases/latest) or install MarkText using [**homebrew cask**](https://github.com/caskroom/homebrew-cask). To use Homebrew-Cask you just need to have [Homebrew](https://brew.sh/) installed.

```bash
brew install --cask mark-text
```

#### Windows

Requires Windows 10 or 11. Both x64 and arm64 installers are published — pick the architecture that matches your machine.

Simply download and install MarkText via the setup wizard (`marktext-win-(x64|arm64)-%version%-setup.exe`) and choose whether to install per-user or machine wide. Alternatively, install MarkText using a package manager such as [Chocolatey](https://chocolatey.org/) or [Winget](https://docs.microsoft.com/en-us/windows/package-manager/winget/).

To use Chocolatey, you need to have [Chocolatey](https://chocolatey.org/install) installed:

```bash
choco install marktext
```

To use Winget, you need to have [Winget](https://docs.microsoft.com/en-us/windows/package-manager/winget/#install-winget) installed:

```bash
winget install marktext
```

#### Linux

Please follow the [Linux installation instructions](https://marktext.me/docs/installation).

#### Other

All binaries for Linux, macOS and Windows can be downloaded from the [release page](https://github.com/marktext/marktext/releases/latest). If a version is unavailable for your system, then please open an [issue](https://github.com/marktext/marktext/issues).

## Development

If you wish to build MarkText yourself, please check out our [build instructions](https://marktext.me/docs/dev/build).

- [User documentation](https://marktext.me/docs/introduction)
- [Developer documentation](https://marktext.me/docs/dev/overview)

If you have any questions regarding MarkText, you are welcome to write an issue. When doing so please use the default format found when opening an issue. Of course, if you submit a PR directly, it will be greatly appreciated.

## Contribution

MarkText is in development, please make sure to read the [Contributing Guide](.github/CONTRIBUTING.md) before making a pull request. Want to add some features to MarkText? Refer to our [roadmap](https://github.com/marktext/marktext/projects) and open issues.

## Contributors

Thank you to all the people who have already contributed to MarkText[[contributors](https://github.com/marktext/marktext/graphs/contributors)].

<a href="https://github.com/marktext/marktext/graphs/contributors"><img src="https://opencollective.com/marktext/contributors.svg?width=890" /></a>

## License

[**MIT**](LICENSE).
