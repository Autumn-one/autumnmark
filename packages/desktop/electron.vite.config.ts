import { resolve, dirname, relative } from 'path'
import { createRequire } from 'node:module'
import { normalizePath, type Plugin, type PluginOption } from 'vite'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import postcssPresetEnv from 'postcss-preset-env'
import packageJson from './package.json' with { type: 'json' }
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const excalidrawFonts = normalizePath(resolve(dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'fonts'))
const excalidrawFontBase = normalizePath(relative(resolve(__dirname, 'src/renderer'), dirname(excalidrawFonts)))
  .split('/').filter(segment => segment && segment !== '..').length
const katexWoff2: Plugin = {
  name: 'katex-woff2',
  enforce: 'pre',
  transform(css, id) {
    if (!/\/katex\/dist\/katex(?:\.min)?\.css(?:\?|$)/.test(normalizePath(id))) return
    // Vite emits CSS URL assets before PostCSS can remove the fallback sources.
    return css.replace(/\bsrc\s*:([^;}]+)/g, (declaration, sources: string) => {
      const woff2 = sources.split(',').find(source => /\.woff2["']?\s*\)/.test(source))
      return woff2 ? `src: ${woff2.trim()}` : declaration
    })
  }
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        // Optional dependencies are outside the production dependency list.
        include: ['native-keymap']
      }
    },
    define: {
      MARKTEXT_VERSION: JSON.stringify(packageJson.version),
      MARKTEXT_VERSION_STRING: JSON.stringify(`v${packageJson.version}`)
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared')
      },
      extensions: ['.mjs', '.ts', '.js', '.json']
    }
  },
  preload: {
    // Sandboxed preload can only require Electron and its supported Node builtins.
    build: {
      externalizeDeps: false
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared')
      },
      extensions: ['.mjs', '.ts', '.js', '.json']
    }
  },
  renderer: {
    build: {
      minify: true,
      rolldownOptions: {
        input: {
          editor: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          themePreview: resolve(__dirname, 'src/renderer/theme-preview.html'),
          themeStudio: resolve(__dirname, 'src/renderer/theme-studio.html')
        }
      }
    },
    // The sandboxed renderer accesses Node only through preload and IPC.
    assetsInclude: ['**/*.md'],
    // Some browser dependencies reference Node’s global; map it to globalThis before imports run.
    define: {
      global: 'globalThis'
    },
    resolve: {
      dedupe: ['cytoscape', 'roughjs'],
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        common: resolve(__dirname, 'src/common'),
        '@shared': resolve(__dirname, 'src/shared'),
        // Shared `common/*` helpers import the bare `path` specifier; route it to
        // a platform-correct module so the renderer never builds mixed-separator
        // paths (#5683).
        path: resolve(__dirname, 'src/renderer/src/node/platformPath.ts')
      },
      extensions: ['.mjs', '.ts', '.js', '.json', '.vue']
    },
    optimizeDeps: {
      // Opening the separate studio or its preview must not invalidate the running editor's optimized modules.
      include: [
        'pako', 'pathe', 'codemirror', 'codemirror/mode/css/css', 'codemirror/mode/markdown/markdown',
        'codemirror/addon/display/placeholder', 'postcss', 'postcss-selector-parser'
      ]
    },
    plugins: [vue(), svgLoader(), katexWoff2, viteStaticCopy({
      targets: [{
        // Excalidraw imports Assistant through its CSS, so Vite emits those faces.
        src: [`${excalidrawFonts}/**/*`, `!${excalidrawFonts}/Assistant/**/*`],
        dest: 'excalidraw',
        rename: { stripBase: excalidrawFontBase }
      }]
    })] as PluginOption[],
    css: {
      postcss: {
        plugins: [
          postcssPresetEnv({
            stage: 0,
            features: {
              'nesting-rules': true,
              // Electron ships Chromium, which supports CSS logical properties
              // natively. Leave them untouched so `padding-inline-start` /
              // `inset-inline-start` mirror correctly under `dir="rtl"` instead
              // of being down-compiled to hard-coded LTR physical props (#4673).
              'logical-properties-and-values': false
            }
          })
        ]
      }
    }
  }
})
