# AutumnMark 打包体积分析与优化方案

## 2026-11-26 对抗性验证与实施结果

Windows x64 本地对照使用 Electron 45.0.0 和 electron-builder 26.18.1。大小按十进制 MB 计。下面各节保留原始提案和历史基线，当前结果以第二轮实测为准。

| 构建 | 便携 ZIP | NSIS 安装包 | 解包后 | 便携 7z |
|---|---:|---:|---:|---:|
| 当前工作区，原打包配置 | 260.5 MB | 214.6 MB | 661.0 MB | — |
| 当前工作区，优化后 | **170.9 MB** | **138.8 MB** | **387.2 MB** | **117.1 MB** |
| 同格式降幅 | 34.4% | 35.3% | 41.4% | — |

- **依赖与文件清单**。实际发布依赖只保留主进程的外部依赖与原生模块。Vite 打包的依赖仍纳入许可证扫描。一次试打包发现单独的负向平台规则会重新纳入源码和测试，调整后验证了 ASAR 根目录和三个正式构建目录。较大的历史测试录像和旧预览构建均被目录映射排除。
- **压缩选项**。相同应用文件开启 `compression: maximum` 后，NSIS 仍为 139,417,784 字节，ZIP 仅减少 310,471 字节。正式配置保留默认压缩与差分更新，另提供兼容的 ZIP 和更轻的 7z 便携包。
- **渲染资源**。按需注册 Element Plus 组件，KaTeX 只打包 WOFF2，Prism 每种语法只打包一份。Excalidraw 的 Xiaolai 字体在离线中文 PNG 预览中实际加载，因此保留全部 209 个切片。Chromium 的语言包、GPU 和媒体运行时文件也保持完整。
- **验证范围**。Windows 精简包通过 ASAR 检查、打包版表格用例和离线 KaTeX、Mermaid、Excalidraw 中文 PNG、本地搜索与系统字体检查。macOS ARM64、Linux x64 和真实更新链路仍需各自的构建验证。

### 第二轮实施与实测

| 构建 | 便携 ZIP | NSIS 安装包 | 解包后 | 便携 7z |
|---|---:|---:|---:|---:|
| 第一轮优化 | 170.9 MB | 138.8 MB | 387.2 MB | 117.1 MB |
| 第二轮优化 | **169.9 MB** | **138.3 MB** | **383.3 MB** | **116.9 MB** |

- 主进程内联 12 个已验证的 JS 依赖，保留原生模块、系统字体工具、日志与更新器的独立运行时文件。移除 `ced` 的重复二进制后，使用正式加载路径通过原生编码检测。
- 12 个 Open Sans 和 DejaVu Sans Mono 字体改用 WOFF2，验证了字符映射、字形轮廓、字宽、布局表和 hinting 指令。移除序列图旧字体格式和 Excalidraw 重复的 Assistant 文件，并仅载入使用到的 Element Plus 样式。
- Cytoscape 和 Rough.js 各合并为一套产物。KaTeX 的剩余副本来自不同 Mermaid 版本要求的不同依赖版本，继续分别保留。Excalidraw 的 209 个 Xiaolai 切片参与按字符加载和导出，因此保留完整的离线字库。[Excalidraw 字体切片和导出说明](https://plus.excalidraw.com/blog/adding-hand-drawn-font-for-chinese-japanese-korean)
- 删除 `dxcompiler.dll` 的对照包在 NVIDIA Blackwell 上创建 WebGPU 设备失败。将语言包裁成英文与中文后，日语 Chromium 表单提示回退成中文。标准包保留 GPU 文件和语言包。
- 标准 NSIS 的两个本地样包通过差分重建测试，下载 **19.8 MB** 后重建产物的 SHA-512 与目标一致。关闭差分打包的本地实验安装包实测 **127.0 MB**，首次下载少 **11.3 MB**，该实验包没有用于此版本的 blockmap。

> 基于当前仓库 `dist/` 打包产物（Windows x64）与 `packages/desktop/out/` 最新构建产物的实测分析。

---

## 一、现状体积剖析（实测数据）

### 1.1 现有产物基线（`dist/`）

| 产物 | 实测大小 | 说明 |
|---|---:|---|
| `dist/autumnmark-win-x64-0.24.0-dev.zip` | **195.8 MB** (186.7 MiB) | 便携版压缩包（DEFLATE 压缩） |
| `dist/autumnmark-win-x64-0.24.0-dev-setup.exe` | **155.7 MB** (148.5 MiB) | NSIS 安装包（7z/LZMA 压缩，当前为默认 `normal` 档） |
| `dist/win-unpacked/` | **523.5 MB** (499.3 MiB) | 解压 / 安装后的磁盘占用 |

### 1.2 195.8 MB `.zip` 内部构成拆解

| 组成部分 | 解压后大小 | 在 `.zip` 中占比 | 核心内容 |
|---|---:|---:|---|
| **Electron 45 运行时** | **318.9 MiB** | **~145 MB (74.1%)** | `autumnmark.exe` (238.2M)、`dxcompiler.dll` (24.6M)、`resources.pak` (12.8M)、`locales/` (11.1M, 17 语种)、`icudtl.dat` (10.3M)、`LICENSES.chromium.html` (5.4M)、`vk_swiftshader.dll` (5.2M)、`d3dcompiler_47.dll` (4.5M)、`ffmpeg.dll` (3.0M) 等 |
| **`app.asar/node_modules`** | **138.5 MiB** | **~38 MB (19.4%)** | **458 个 npm 包**，绝大多数是已被 Vite 打入 `out/renderer` 的前端依赖（详见 1.3） |
| **`app.asar/out/`** | **26.2 MiB** | **~7.5 MB (3.8%)** | `out/main` (1.07M) + `out/preload` (0.05M) + `out/renderer` (25.04M) |
| **`app.asar.unpacked/`** | **7.0 MiB** | **~2.4 MB (1.2%)** | `rg.exe` (5.18M)、`keytar.node` (0.67M)、两份重复的 `ced.node` (共 0.70M)、`keymapping.node` (0.16M)、`font-list` 等 |
| **误打包的 `test/` 与重复 `static/`** | **2.7 MiB** | **~0.8 MB (0.4%)** | `app.asar/test` (1.62M) + `app.asar/static` (1.08M) |
| **`resources/static` / `icons` / 其余** | **0.9 MiB** | **~0.3 MB (0.2%)** | 实际使用的外部静态资源与图标 |

> **说明**：`app.asar` 整体作为单个大文件被 `.zip` 压缩后为 46.09 MiB（约 48.3 MB），按各子目录单独 deflate 占比拆分，其中 `node_modules` 约占 38 MB，`out/` 约占 7.5 MB，`test/` + `static/` 约占 0.8 MB。

### 1.3 `app.asar/node_modules` 前 15 大冗余包（全部属于纯渲染进程依赖）

| 包名 | 在 `app.asar` 中体积 | 实际使用位置 | 是否需要打入 `app.asar/node_modules` |
|---|---:|---|---|
| `mermaid` | 22.93 MB | 渲染进程（已由 Vite 打包） | **否** |
| `element-plus` | 14.47 MB | 渲染进程（已由 Vite 打包） | **否** |
| `cytoscape-fcose` | 8.87 MB | `mermaid` 传递依赖 | **否** |
| `elkjs` | 7.63 MB | `mermaid` 传递依赖 | **否** |
| `@muyajs/core` | 6.85 MB | 渲染进程（已由 Vite 打包） | **否** |
| `cytoscape` | 5.13 MB | `mermaid` 传递依赖 | **否** |
| `snapsvg` | 4.45 MB | 渲染进程（已由 Vite 打包） | **否** |
| `vega-lite` | 3.89 MB | `@muyajs/core` 传递依赖 | **否** |
| `vega` | 3.55 MB | `@muyajs/core` 传递依赖 | **否** |
| `@vue/compiler-sfc` | 3.54 MB | 编译期依赖 | **否** |
| `@element-plus/icons-vue` | 3.04 MB | 渲染进程（已由 Vite 打包） | **否** |
| `@mermaid-js/parser` | 3.02 MB | `mermaid` 传递依赖 | **否** |
| `katex` | 3.01 MB | 渲染进程（已由 Vite 打包） | **否** |
| `codemirror` | 2.71 MB | 渲染进程（已由 Vite 打包） | **否** |
| `es-toolkit` / `rxjs` / `prismjs` / `vue-i18n` / `vue-router` / `dompurify` 等 | > 20 MB | 渲染进程（已由 Vite 打包） | **否** |

### 1.4 近期体积膨胀预警（当前最新工作区 vs 已有 `dist/`）

当前代码库已引入 Excalidraw，但上述 `dist/` 产物尚未包含最新的 Excalidraw 体积变化。实测当前工作区新增了两块显著增量：

1. `node_modules/@excalidraw/excalidraw`：**44.65 MB**（加上 `react-dom` **4.31 MB**、`react` **0.31 MB**），均写在 `dependencies` 中；
2. `packages/desktop/out/renderer` 已从 25.04 MB 涨至 **37.93 MB**，其中 `out/renderer/excalidraw/fonts/Xiaolai` 独占 **12.08 MB**（209 个已压缩 `.woff2` 文件，**几乎无法再次压缩**）。

如果不先执行下述瘦身方案而直接重新打包，产物将进一步膨胀至：
- `.zip`：**~220 – 230 MB**
- NSIS `.exe`：**~175 – 185 MB**
- 安装后磁盘占用：**~585 MB**

---

## 二、分阶段优化方案

### 方案 A：打包配置与依赖清理（低风险、收益最大，强烈建议优先落地）

#### A1. 清理 `app.asar/node_modules` 中的冗余前端依赖

**根因**：
- `packages/desktop/package.json` 的 `dependencies` 混放了渲染进程依赖和主进程依赖；
- `electron-builder` 会把 `dependencies` 及其全部传递依赖完整拷贝到 `app.asar/node_modules`；
- 实测 `out/preload/index.js` 仅 `require('electron')`；`out/main/index.js` 实际仅依赖以下两类包：
  - **必须外置的原生/外部二进制包（5 个）**：`@vscode/ripgrep`、`keytar`、`ced`、`native-keymap`、`font-list`；
  - **可直接打进 `out/main/index.js` 的纯 JS 包（约 15 个）**：`@electron-toolkit/utils`、`ajv`、`ajv-formats`、`arg`、`chokidar`、`command-exists`、`electron-log`、`electron-updater`、`fast-diff`、`fs-extra`、`fuzzaldrin`、`lodash/debounce`、`minimatch`、`postcss`、`proper-lockfile`、`write-file-atomic`。

**落地步骤**：

1. 修改 `packages/desktop/electron.vite.config.ts`，让 `main` 只外置 5 个原生/外部工具包（或分两步，先外置主进程全部 ~20 个依赖，再收敛为只外置 5 个原生包）：

```ts
// packages/desktop/electron.vite.config.ts
const MAIN_EXTERNAL_DEPS = [
  '@vscode/ripgrep',
  'keytar',
  'ced',
  'native-keymap',
  'font-list'
]

export default defineConfig({
  main: {
    build: {
      // 关闭自动全量外置，改为显式只外置原生/二进制模块，其余纯 JS 依赖打入 out/main/index.js
      externalizeDeps: false,
      rolldownOptions: {
        external: [
          'electron',
          ...MAIN_EXTERNAL_DEPS,
          // 保留 node 内置模块外置（electron-vite 默认已处理 builtinModules，也可显式引入 node:module builtinModules）
        ]
      }
    },
    // ...
  }
})
```

> **保守替代做法**：如果担心 `electron-updater`、`chokidar` 等主进程纯 JS 包 bundle 后有动态 `require` 兼容问题，可先仅将所有**纯渲染进程依赖**从 `dependencies` 移到 `devDependencies`，保持主进程 ~20 个依赖仍在 `dependencies` 中。这样也能立即消除 **90%+**（约 125 MB+，含 Excalidraw 约 175 MB+）的 `app.asar/node_modules` 体积，再逐步测试将纯 JS 主进程包打进 `out/main/index.js`。

2. 调整 `packages/desktop/package.json`：
   - 将所有纯渲染进程包（`@excalidraw/excalidraw`、`@element-plus/icons-vue`、`@marktext/file-icons`、`@muyajs/core`、`axios`、`codemirror`、`deep-equal`、`dom-autoscroller`、`dompurify`、`dragula`、`element-plus`、`flowchart.js`、`github-markdown-css`、`iso-639-1`、`katex`、`mermaid`、`mitt`、`ms`、`pako`、`pathe`、`pinia`、`postcss-selector-parser`、`prismjs`、`react`、`react-dom`、`snabbdom`、`snabbdom-to-html`、`snapsvg-cjs`、`underscore`、`vue-i18n`、`vue-router`、`webfontloader`、`@intlify/core-base`、`@jsr/std__path`、`@csstools/css-tokenizer` 等）移入 `devDependencies`。
   - **重要联动检查**：项目根目录下 `scripts/thirdPartyChecker.ts` 和 `scripts/generateThirdPartyLicense.ts` 会扫描生产依赖做开源许可证合规校验。移动依赖前需确认这两个脚本是否只读 `dependencies`，如果是，需同步调整其扫描策略，避免漏报已打入前端 bundle 的第三方许可证。

**预期收益**：
- 解压后：**-138 MB**（含 Excalidraw 时为 **-185 MB**）
- `.zip`：**-38 ~ -40 MB**
- NSIS `.exe`：**-22 ~ -28 MB**

---

#### A2. 排除 `app.asar` 中误打包与重复文件

**定位**：
- `app.asar/test/`（**1.62 MB**）：`electron-builder.yml` 未排除 `test` 目录；
- `app.asar/static/`（**1.08 MB**）：`packages/desktop/src/main/globalSetting.ts:12` 在打包态下仅读取 `path.join(process.resourcesPath, 'static')`（即 `extraResources`），且 `preference.json` 已被静态 `import` 进主进程代码，`app.asar/static` 完全是冗余拷贝；
- `app.asar.unpacked/node_modules/` 中的冗余与跨平台残留：
  - `ced/bin/win32-x64-150/ced.node` (0.35 MB) 与 `ced/build/Release/ced.node` (0.35 MB) 重复两份（需确认 `ced/index.js` 实际加载路径后移除未用那一份）；
  - `ced/build/vendor/**` 下的 `.tlog`/`.recipe`/`.lastbuildstate` 和 `ced.cpp`；
  - `native-keymap/src/**`、`native-keymap/deps/**` 等 C++/头文件源码；
  - `font-list/libs/darwin/**` 在 Windows 包中无用（同理 `win32/**` 在 macOS/Linux 包中无用）。

**落地配置**（`packages/desktop/electron-builder.yml`）：

```yaml
files:
  # ... 保留已有规则，新增以下排除项：
  - '!test/**'
  - '!static/**'
  - '!patches/**'
  - '!{vitest,playwright}.config.ts'
  - '!tsconfig*.json'
  - '!node_modules/ced/build/vendor/**'
  - '!node_modules/ced/ced.cpp'
  - '!node_modules/native-keymap/{src,deps}/**'
  - '!node_modules/native-keymap/{SECURITY.md,ThirdPartyNotices.txt,PoliCheckExclusions.xml}'
  # 需先确认 ced/index.js 加载优先级（优先 bin/ 或 build/Release/）后排除未用的一份
```

并在各平台节点下可按平台排除 `font-list` 的异构目录（如 Windows 下排除 `!node_modules/font-list/libs/{darwin,linux}/**`）。

**预期收益**：
- 解压后：**-3.5 MB**
- `.zip` / `.exe`：**-1 ~ -1.5 MB**

---

#### A3. 剔除或按需加载 Excalidraw 的 `Xiaolai` 中文字体

**定位**：
- `packages/desktop/electron.vite.config.ts` 第 14、93–95 行将 `@excalidraw/excalidraw` 的整个 `fonts/` 目录拷贝到 `out/renderer/excalidraw/`；
- `packages/desktop/src/renderer/src/services/drawingFonts.ts:1` 通过 `EXCALIDRAW_ASSET_PATH` 指向 `./excalidraw/`；
- 实测 `out/renderer/excalidraw/fonts` 总计 **12.50 MB**，其中：
  - `Xiaolai/`（209 个 `.woff2` 切片）：**12.08 MB（占 96.6%）**
  - 其余全部字体（`Assistant`、`Liberation`、`Cascadia`、`Excalifont`、`Nunito`、`Virgil`、`ComicShanns`、`Lilita`）：合计仅 **0.42 MB**。
- 由于 `.woff2` 已经是 Brotli 高压缩格式，这 **12.08 MB 无法被 `.zip` 或 NSIS LZMA 再次压缩**，会 1:1 直接叠加到所有平台的安装包体积上。

**可选落地策略**：
1. **推荐（立省 12 MB）**：在 `viteStaticCopy` 中排除 `Xiaolai`，Excalidraw 中文文本自动回退系统字体（Windows 微软雅黑 / macOS 苹方 / Linux Noto Sans CJK）：
   ```ts
   viteStaticCopy({
     targets: [{
       src: [`${excalidrawFonts}/*`, `!${excalidrawFonts}/Xiaolai`],
       dest: 'excalidraw/fonts'
     }]
   })
   ```
   > 需在 Excalidraw 画布中验证：选择中文输入以及导出 PNG/SVG 时，缺少 `Xiaolai` 文件不会产生未捕获错误或阻塞导出（如 Excalidraw 主动请求 `Xiaolai/*.woff2`，可同时检查是否需要屏蔽字体菜单中的 Xiaolai 或按需下载）。
2. **进阶（保留手写中文字体体验且不占安装包）**：首次用户切换到 Xiaolai 字体时，通过主进程从 GitHub Release / CDN 下载到 `userData/fonts/Xiaolai`，再通过自定义协议或本地路径提供服务。

**预期收益**（相对当前最新源码构建）：
- 解压后 / `.zip` / `.exe`：**全部直接 -12.08 MB**

---

#### A4. 开启最高压缩等级 & 优化便携包分发格式

**定位**：
- `packages/desktop/electron-builder.yml` 目前未配置 `compression`，默认使用 `normal`。
- Windows 便携版目前只打 `zip`（DEFLATE 算法），对 238 MB 的 `autumnmark.exe` 压缩率远不如 LZMA（`.7z`）。

**落地配置**（`packages/desktop/electron-builder.yml`）：

```yaml
compression: maximum
```

- **对 NSIS `.exe`**：7z/LZMA 固实压缩切换至 `maximum`（仅增加 CI 约 20–40 秒打包时间，不影响用户安装体验），可再减 **~10 – 16 MB**；
- **对 macOS `.dmg` / Linux `.AppImage`**：同样直接受益于 `compression: maximum`；
- **对 Windows 便携版**（可选）：如果将 `win.target` 中的 `zip` 替换为 `7z`（或主推 `7z` 便携包），便携包体积可额外再减 **~35 – 45 MB**。

---

### 方案 B：渲染进程资源与 Bundle 精细瘦身（中低风险，中等收益）

#### B1. 精简重复与老旧格式字体

实测当前 `out/renderer/` 中的非 Excalidraw 字体体积：

| 字体资源 | 当前体积 | 问题与优化方式 | 预计节省（解压） |
|---|---:|---|---:|
| KaTeX `.ttf` (20 个) + `.woff` (20 个) | 0.78 MB | 同时打包了 `.ttf`、`.woff`、`.woff2` 三套格式；Electron 基于现代 Chromium，**仅保留 `.woff2`（0.24 MB）即可**。通过自定义 Vite 插件或在构建时过滤/重写 `katex.min.css` 的 `src` 规则实现（注意兼容 `packages/muya/src/utils/embedExportFonts.ts` 导出 HTML 时内嵌 woff2 的逻辑）。 | **~0.78 MB** |
| `DejaVuSansMono` (4 个 `.ttf`) | 1.12 MB | 定义在 `packages/muya/src/assets/styles/index.css:168-203`。方案 1：转为 `.woff2` 格式（体积减半）；方案 2：默认代码字体优先使用系统等宽字体（Consolas / Menlo / Cascadia Mono），取消内嵌。 | **0.55 – 1.12 MB** |
| `open-sans` (8 个 `.woff`) | 0.21 MB | 定义在 `packages/muya/src/assets/styles/index.css:68-145`。可转为 `.woff2` 或改用系统 UI 字体栈。 | **0.10 – 0.21 MB** |
| `danielbd` (`.woff` + `.woff2`) | 0.07 MB | 序列图手写字体重复了 `.woff`，仅留 `.woff2`。 | **~0.04 MB** |
| `Assistant-*.woff2` | 0.08 MB | 同时存在于 `assets/` 和 `excalidraw/fonts/Assistant/` 两处，可去重。 | **~0.08 MB** |

**预期收益**：解压后 **-1.5 ~ -2.2 MB**，安装包 **-1 ~ -1.8 MB**。

---

#### B2. 消除前端重复 Chunk & Element Plus 按需引入

实测当前 `out/renderer/` 包含 **1,128 个 `.js` 文件，共 21.06 MB**，发现以下可优化点：

1. **重复打包的公共库**：
   - `assets/` 中同时存在 `katex-B940_AAO.js` (0.25 MB) 与 `katex-DJhrJSbw.js` (0.25 MB)；
   - 同时存在 `cytoscape.esm-CIUYqbo9.js` (0.42 MB) 与 `cytoscape.esm-DFH66zfw.js` (0.41 MB)；
   - 原因通常是 `packages/desktop` 与 `packages/muya` 的依赖解析副本或 4 个 HTML 入口（`editor`、`settings`、`themePreview`、`themeStudio`）重复抽 chunk。可通过统一 `pnpm-workspace.yaml` 依赖版本并在 `electron.vite.config.ts` 中核查 `dedupe` / `manualChunks` 消除重复。
2. **Element Plus 按需引入**：
   - 当前 `packages/desktop/src/renderer/src/main.ts:5-6` 采用全量导入：
     ```ts
     import ElementPlus from 'element-plus'
     import 'element-plus/dist/index.css'
     ```
   - 改为 `unplugin-vue-components` + `ElementPlusResolver` 按需加载组件与对应样式，可减少未使用的 Element Plus 组件 JS 与全量 CSS（`createRenderer-*.css` 等），同时改善启动解析耗时。
3. **重型图表引擎审查（可选）**：
   - `mermaid` + `elkjs` + `cytoscape` 合计约 **7.5 MB** JS（仅 `elk` 就占 ~3.1 MB）；
   - `vega` / `vega-lite` / `vega-embed`（若业务上使用频率极低，可评估是否保留或按需外置插件化）；
   - 保持离线优先体验的前提下，建议保留核心图表引擎，只做去重与懒加载。

**预期收益**：解压后 **-4 ~ -8 MB**，安装包 **-1 ~ -3 MB**。

---

### 方案 C：Electron 运行时裁剪（高收益但有取舍/需充分测试）

完成方案 A + B 后，应用自身代码与资源在安装包里仅剩约 **10–13 MB**，剩余约 **85%+** 全部来自 **Electron 45 自身的 Chromium + Node.js 运行时**（解压 319 MiB，`.zip` 约 145 MB）。若需进一步压缩：

#### C1. 精简 Chromium `locales` 语言包

- 当前 `electron-builder.yml` 的 `electronLanguages` 保留了 17 个 `.pak` 文件（**11.05 MB 解压 / 3.10 MB `.zip`**）。
- 应用自有 UI 全部使用 `static/locales/*.min.json`，Chromium `.pak` 仅影响极少数内置原生右键菜单/表单验证提示。
- 如仅保留核心语言（例如 `en-US`、`zh-CN`、`zh-TW`），可再省 **~2.3 MB（`.zip`） / ~8.5 MB（解压后）**。

#### C2. 评估移除 `dxcompiler.dll`（高风险，须实机验证）

- Electron 45 在 Windows 下携带了 `dxcompiler.dll`（**24.59 MB 解压 / 9.43 MB `.zip` / ~6 MB `.exe`**），主要用于 WebGPU / ANGLE D3D12 着色器编译。
- 可通过 `electron-builder` 的 `afterPack` 钩子测试移除该文件：
  - **风险**：在部分 Windows 10/11 驱动环境下可能影响 WebGPU 或 ANGLE D3D12 渲染路径。
  - **前提**：必须在无独显核显机、独显机、虚拟机/远程桌面下全面回归测试编辑器渲染、Canvas/Excalidraw、KaTeX、Mermaid 与视频播放，确认无崩溃或黑屏后才可启用。

#### C3. 不建议删除的运行时文件

| 文件 | 大小（解压 / `.zip`） | 不建议删除原因 |
|---|---:|---|
| `LICENSES.chromium.html` | 5.44 MB / 0.63 MB | Chromium/Electron 开源协议合规要求，且压缩后仅 0.63 MB |
| `vk_swiftshader.dll` + `vulkan-1.dll` | 6.11 MB / 2.34 MB | 无 GPU / 驱动异常时的软件渲染兜底 |
| `d3dcompiler_47.dll` | 4.53 MB / 1.98 MB | Windows ANGLE D3D11 渲染依赖 |
| `ffmpeg.dll` | 2.95 MB / 1.16 MB | 音视频播放支持（且压缩后仅 1.16 MB） |

---

### 方案 D：架构级方案（长期参考）

如果产品目标是将安装包降到 **15 – 30 MB** 级别，唯一根本路径是脱离 Electron（例如迁移至复用系统 WebView2 / WKWebView / WebKitGTK 的 **Tauri 2**）。但鉴于 AutumnMark 深度依赖：
- Electron `runAsNode` 供内置 Skill 桥接脚本复用 Node 运行时；
- 多窗口管理、`session.extensions` 主题检查器扩展加载；
- `keytar`、`ced`、`native-keymap`、`chokidar`、`electron-updater` 等 Node/Electron 生态模块；

短期迁移投入产出比过低，**当前阶段不建议走架构重写路线**。

---

## 三、最终体积预估总表

| 优化阶段 | Windows 便携包 (`.zip` / `.7z`) | Windows 安装包 (NSIS `.exe`) | 安装后磁盘占用 | 相对 195.8 MB `.zip` 降幅 |
|---|---:|---:|---:|---:|
| **当前已有 `dist/` 产物**（不含新 Excalidraw） | **195.8 MB** (`.zip`) | **155.7 MB** | **~523 MB** | 基线 |
| **当前源码直接重打**（含 Excalidraw + `Xiaolai`） | *~220 – 230 MB* (`.zip`) | *~175 – 185 MB* | *~585 MB* | *+12% ~ +17%* |
| **落地「方案 A」**（清 `node_modules` + 排除冗余 + 去掉 `Xiaolai` + `compression: maximum`） | **~150 – 158 MB** (`.zip`)<br>**~105 – 115 MB** (改 `.7z`) | **~110 – 120 MB** | **~365 – 375 MB** | `.zip` **-19% ~ -23%**<br>`.exe` **-23% ~ -29%** |
| **落地「方案 A + B」**（叠加字体精简 + 前端去重 + Element Plus 按需） | **~145 – 153 MB** (`.zip`)<br>**~100 – 110 MB** (改 `.7z`) | **~105 – 115 MB** | **~350 – 365 MB** | `.zip` **-22% ~ -26%**<br>`.exe` **-26% ~ -33%** |
| **落地「方案 A + B + C」**（叠加精简 locales + 验证后删 `dxcompiler.dll`） | **~133 – 142 MB** (`.zip`)<br>**~92 – 102 MB** (改 `.7z`) | **~96 – 106 MB** | **~320 – 335 MB** | `.zip` **-27% ~ -32%**<br>`.exe` **-32% ~ -38%** |

> **核心结论**：在不更换 Electron 45 框架、不牺牲任何核心编辑功能的前提下，执行最稳妥的 **方案 A + B**：
> - Windows NSIS 安装包可从 **156 MB（含 Excalidraw 约 180 MB）降到 ~105 – 115 MB**；
> - Windows `.zip` 便携包可从 **196 MB（含 Excalidraw 约 225 MB）降到 ~145 – 153 MB**（若便携包改用 `.7z`，可直接降至 **~100 – 110 MB**）；
> - 安装后的磁盘占用可从 **~523 MB（含 Excalidraw 约 585 MB）降到 ~350 – 365 MB**。

---

## 四、推荐实施顺序与验收清单

### 实施顺序

1. **第 1 步（半天，最高 ROI）**：
   - 将纯渲染进程依赖从 `packages/desktop/package.json` 的 `dependencies` 移至 `devDependencies`，同步检查 `scripts/thirdPartyChecker.ts` 与 `scripts/generateThirdPartyLicense.ts`；
   - 在 `packages/desktop/electron-builder.yml` 中增加 `!test/**`、`!static/**`、`compression: maximum` 与原生模块源码/残留排除；
   - 在 `packages/desktop/electron.vite.config.ts` 中排除 Excalidraw `Xiaolai` 字体。
2. **第 2 步（半天）**：
   - 将 `main` 进程的纯 JS 依赖打入 `out/main/index.js`，仅外置 5 个原生/外部工具包（`@vscode/ripgrep`、`keytar`、`ced`、`native-keymap`、`font-list`），彻底清空 `app.asar/node_modules` 中的非原生依赖；
   - 核实 `ced` 双份 `ced.node` 加载路径并移除冗余那份。
3. **第 3 步（1 天，按需）**：
   - KaTeX 字体仅保留 `.woff2`、`DejaVuSansMono` 转 `.woff2` 或改系统字体、消除 `katex`/`cytoscape` 双份 chunk、Element Plus 按需引入。
4. **第 4 步（可选，充分测试后再决定）**：
   - 评估是否增加 `.7z` 便携包、精简 Chromium `locales`、测试移除 `dxcompiler.dll`。

### 每次改完后的验证点

1. **体积核查**：执行 `pnpm run build:win`（或各平台 CI 构建），检查 `dist/` 下 `.exe` / `.zip` 大小以及 `dist/win-unpacked/resources/app.asar` 内部 `node_modules` 目录列表。
2. **主进程运行回归**：
   - 文件打开/保存/自动编码检测（`ced`）
   - 全局搜索（`@vscode/ripgrep`）
   - 快捷键映射（`native-keymap`）
   - 系统字体列表加载（`font-list`）
   - 凭证存储（`keytar`）
   - 自动更新检查（`electron-updater`）与日志写入（`electron-log`）
   - 内置 Skill（`runAsNode`）与 `static/` 资源加载（多语言切换、主题预览、主题检查器）
3. **渲染进程运行回归**：
   - KaTeX 数学公式渲染 & HTML/PDF 导出内嵌字体
   - Mermaid / Vega / Flowchart 图表渲染
   - Excalidraw 画布中英文输入、字体切换与 PNG/SVG 导出
   - 代码块高亮（Prism / CodeMirror）与 Element Plus 对话框/设置页交互
4. **质量检查**：运行 `pnpm run lint`、`pnpm run typecheck`、`pnpm run validate-licenses` 与 `pnpm run test:unit`。
