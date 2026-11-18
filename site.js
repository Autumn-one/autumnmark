const releasePage = 'https://github.com/Autumn-one/autumnmark/releases/latest'
const releaseApi = 'https://api.github.com/repos/Autumn-one/autumnmark/releases/latest'
const assetPrefix = 'https://github.com/autumn-one/autumnmark/releases/download/'

function enhanceTabs(group) {
  const tablist = group.querySelector('[role="tablist"]')
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'))
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')))

  function selectTab(selected) {
    tabs.forEach((tab, index) => {
      const active = index === selected
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      panels[index].hidden = !active
    })
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(index))
    tab.addEventListener('keydown', (event) => {
      let next
      switch (event.key) {
        case 'ArrowLeft':
          next = (index - 1 + tabs.length) % tabs.length
          break
        case 'ArrowRight':
          next = (index + 1) % tabs.length
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = tabs.length - 1
          break
        default:
          return
      }
      event.preventDefault()
      selectTab(next)
      tabs[next].focus()
    })
  })

  tablist.hidden = false
}

const installers = {
  win: { x64: /^autumnmark-win-x64-.+-setup\.exe$/i, arm64: /^autumnmark-win-arm64-.+-setup\.exe$/i },
  mac: { x64: /^autumnmark-mac-x64-.+\.dmg$/i, arm64: /^autumnmark-mac-arm64-.+\.dmg$/i },
  linux: { x64: /^autumnmark-linux-(?:x64-)?v?\d.+\.AppImage$/i, arm64: /^autumnmark-linux-arm64-.+\.AppImage$/i }
}

function installerUrl(assets, pattern) {
  const asset = assets.find(({ name, browser_download_url }) =>
    pattern.test(name) && browser_download_url?.toLowerCase().startsWith(assetPrefix)
  )
  return asset?.browser_download_url
}

function enhanceDownload(card, assets) {
  const patterns = installers[card.dataset.platform]
  const select = card.querySelector('select')
  const link = card.querySelector('a')
  const system = card.querySelector('h3').textContent
  const urls = new Map()

  for (const option of select.options) {
    const url = installerUrl(assets, patterns[option.value])
    option.disabled = !url
    if (url) urls.set(option.value, url)
  }

  if (urls.size === 0) return

  if (!urls.has(select.value)) select.value = urls.keys().next().value
  select.hidden = false

  function updateLink() {
    const architecture = select.selectedOptions[0]?.textContent
    link.href = urls.get(select.value) ?? releasePage
    link.setAttribute('aria-label', `下载 ${system} ${architecture} 安装包`)
  }

  link.replaceChildren('下载安装包')
  select.addEventListener('change', updateLink)
  updateLink()
}

async function readRelease(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!response.ok) return undefined

    const release = await response.json()
    if (typeof release.tag_name === 'string' && Array.isArray(release.assets) && release.assets.length > 0) return release
  } catch {
    return undefined
  }
}

async function showInstallers() {
  let release = await readRelease(releaseApi)
  if (!release) release = await readRelease('./release-fallback.json')
  if (!release) return

  document.querySelectorAll('[data-platform]').forEach((card) => enhanceDownload(card, release.assets))
  document.querySelector('[data-release-version]').textContent = `${release.tag_name} · 发布记录`
}

document.querySelectorAll('[data-tabs]').forEach(enhanceTabs)
void showInstallers()
