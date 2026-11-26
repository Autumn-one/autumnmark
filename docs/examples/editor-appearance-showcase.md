# 秋笺 · 排版美学与外观演示

> 好的编辑器外观从不喧宾夺主：清晰的标题建立空间秩序，温润的引用衬底托住灵感，利落的代码着色与对齐表格则让阅读一气呵成。

## 一、标题层级与视觉阶梯

### 三级标题 · 章节焦点

#### 四级标题 · 细节维度

##### 五级标题 · 辅助标注

###### 六级标题 · 元信息锚点

```ts title="theme-tokens.ts"  max-lines=5
export interface ThemeTokens {
  name: string
  dark: boolean
  accent: string
  surface: string
  lineHeight: number
}

// 根据系统外观生成默认主题参数
export function createPreset(dark: boolean): ThemeTokens {
  return {
    name: dark ? 'Violet Diary' : 'Pine Ink',
    dark,
    accent: dark ? '#efabc8' : '#396953',
    surface: dark ? '#221e2e' : '#faf7ef',
    lineHeight: 1.75
  }
}
```

| 元素类别     | Markdown 语法                              | 对齐方式 | 建议比例 |
|:------------ |:------------------------------------------ |:--------:| --------:|
| **一级标题** | `# Heading 1`                              | 左对齐   | 2.40×    |
| **二级标题** | `## Heading 2`                             | 左对齐   | 1.55×    |
| **引用语块** | `> Blockquote`                             | 居中     | 0.98×    |
| **行内代码** | `` `inline` ``                             | 居中     | 0.90×    |
| **规范链接** | [GFM 规范](https://github.github.com/gfm/) | 右对齐   | 1.00×    |

---

## 五、公式、图示与交互元素

行内公式如黄金分割比 $\varphi = \frac{1 + \sqrt{5}}{2} \approx 1.618$；块级公式展示独立居中的数学排版：

$$
C = \frac{L_{\max} + 0.05}{L_{\min} + 0.05} \quad (L \in [0, 1])
$$

```mermaid
flowchart LR
    A[Markdown 源码] --> B[语法树解析] --> C[主题样式渲染]
```

![Markdown 主题色板与字体标本卡片](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2ODAiIGhlaWdodD0iMTQ4IiB2aWV3Qm94PSIwIDAgNjgwIDE0OCIgZmlsbD0ibm9uZSI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCIgeTE9IjAiIHgyPSI2ODAiIHkyPSIxNDgiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3RvcC1jb2xvcj0iIzE3MmQyOCIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjU1JSIgc3RvcC1jb2xvcj0iIzI2MzMzZiIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiMzNTI4NDIiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImFjY2VudCIgeDE9IjM2IiB5MT0iMTA0IiB4Mj0iMjkwIiB5Mj0iMTA0IiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+CiAgICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiNlOGMyN2UiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdG9wLWNvbG9yPSIjZWZhYmM4Ii8+CiAgICA8L2xpbmVhckdyYWRpZW50PgogIDwvZGVmcz4KICA8cmVjdCB4PSIxIiB5PSIxIiB3aWR0aD0iNjc4IiBoZWlnaHQ9IjE0NiIgcng9IjE0IiBmaWxsPSJ1cmwoI2JnKSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utb3BhY2l0eT0iMC4xNiIgc3Ryb2tlLXdpZHRoPSIxLjUiLz4KICA8Y2lyY2xlIGN4PSI1OTYiIGN5PSI0NCIgcj0iNTQiIHN0cm9rZT0iI2VmYWJjOCIgc3Ryb2tlLW9wYWNpdHk9IjAuMTYiIHN0cm9rZS13aWR0aD0iMS4yIi8+CiAgPGNpcmNsZSBjeD0iNTk2IiBjeT0iNDQiIHI9IjMyIiBzdHJva2U9IiNlOGMyN2UiIHN0cm9rZS1vcGFjaXR5PSIwLjIyIiBzdHJva2Utd2lkdGg9IjEuMiIvPgogIDx0ZXh0IHg9IjM2IiB5PSI3MiIgZmlsbD0iI2ZhZjVlOCIgZm9udC1mYW1pbHk9Ikdlb3JnaWEsIHNlcmlmIiBmb250LXNpemU9IjQ0IiBmb250LXdlaWdodD0iNzAwIj5BYTwvdGV4dD4KICA8dGV4dCB4PSIxMDgiIHk9IjU0IiBmaWxsPSIjZThjMjdlIiBmb250LWZhbWlseT0ic3lzdGVtLXVpLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjExIiBmb250LXdlaWdodD0iNjAwIiBsZXR0ZXItc3BhY2luZz0iMi40Ij5NQVJLRE9XTiBUSEVNRSBTUEVDSU1FTjwvdGV4dD4KICA8dGV4dCB4PSIxMDgiIHk9Ijc2IiBmaWxsPSIjZDllMGRjIiBmb250LWZhbWlseT0ic3lzdGVtLXVpLCBzYW5zLXNlcmlmIiBmb250LXNpemU9IjE0Ij5IZWFkaW5ncyDCtyBRdW90ZXMgwrcgQ29kZSDCtyBUYWJsZXM8L3RleHQ+CiAgPHJlY3QgeD0iMzYiIHk9IjEwMiIgd2lkdGg9IjI0OCIgaGVpZ2h0PSIzIiByeD0iMS41IiBmaWxsPSJ1cmwoI2FjY2VudCkiIG9wYWNpdHk9IjAuODgiLz4KICA8cmVjdCB4PSIzNzIiIHk9IjQ0IiB3aWR0aD0iNDQiIGhlaWdodD0iNjAiIHJ4PSI4IiBmaWxsPSIjMzk2OTUzIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS1vcGFjaXR5PSIwLjIiLz4KICA8cmVjdCB4PSI0MjYiIHk9IjQ0IiB3aWR0aD0iNDQiIGhlaWdodD0iNjAiIHJ4PSI4IiBmaWxsPSIjYWI3OTQxIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS1vcGFjaXR5PSIwLjIiLz4KICA8cmVjdCB4PSI0ODAiIHk9IjQ0IiB3aWR0aD0iNDQiIGhlaWdodD0iNjAiIHJ4PSI4IiBmaWxsPSIjMTVhYzhlIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS1vcGFjaXR5PSIwLjIiLz4KICA8cmVjdCB4PSI1MzQiIHk9IjQ0IiB3aWR0aD0iNDQiIGhlaWdodD0iNjAiIHJ4PSI4IiBmaWxsPSIjN2FhMmY3IiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS1vcGFjaXR5PSIwLjIiLz4KICA8cmVjdCB4PSI1ODgiIHk9IjQ0IiB3aWR0aD0iNDQiIGhlaWdodD0iNjAiIHJ4PSI4IiBmaWxsPSIjZWZhYmM4IiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS1vcGFjaXR5PSIwLjIiLz4KPC9zdmc+ 'Markdown Theme Specimen')

<!-- tabs -->

#### | 浅色纸墨

适合白天长文撰写：暖白纸底配合低饱和墨绿与古铜点缀，保持柔和专注。

#### | 深色夜笺

适合夜间沉浸阅读：深紫灰背景搭配浅粉紫高亮，代码块对比克制不刺眼。

<!-- /tabs -->

<!-- fold -->

### 展开查看主题预览要点

切换不同主题时，可重点留意一级标题卡片、引用边框与代码块底色之间的明暗层次。

<!-- /fold -->

## 六、列表与任务清单

- 无序条目一：保持行宽适中
- 无序条目二：控制缩进层级
  - 嵌套子项：简洁即可
1. 确认标题与引用块层级
2. 核对代码着色与表格边框
- [x] 标题、引用、代码块与表格展示完成
- [x] 公式、流程图与行内格式就绪
- [ ] 按需调整个人偏好的主题配色

---

> 示例文档 · 适用于 [AutumnMark (秋笺)](https://github.com/Autumn-one/autumnmark) 及常见 Markdown 编辑器外观预览。
