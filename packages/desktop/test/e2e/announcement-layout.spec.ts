import { expect, test } from '@playwright/test'
import { launchElectron } from './helpers'

test('shows live About information below announcements and stacks donation codes on the right', async () => {
  const { app, page } = await launchElectron()
  try {
    await app.evaluate(({ ipcMain }) => {
      const channel = 'mt::remote-content::fetch'
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, kind: string) => ({
        status: 'ready',
        content: {
          markdown: kind === 'about' ? '## Community updates\n\nCommunity fixture' : '## Product notices',
          verified: true
        }
      }))
    })

    await page.setViewportSize({ width: 1000, height: 760 })
    await page.locator('.announcement-trigger').click()
    const dialog = page.locator('.announcement-dialog')
    const feeds = dialog.locator('.announcement-feeds > section')
    const donation = dialog.locator('.announcement-donation')
    await expect(feeds.nth(1).getByText('Community fixture')).toBeVisible()
    const codes = donation.locator('figure img')
    await expect(codes).toHaveCount(2)
    await expect(codes.first()).toHaveJSProperty('complete', true)
    await expect(codes.last()).toHaveJSProperty('complete', true)

    const [news, community, sidebar, alipay, wechat] = await Promise.all([
      feeds.first().boundingBox(),
      feeds.nth(1).boundingBox(),
      donation.boundingBox(),
      codes.first().boundingBox(),
      codes.last().boundingBox()
    ])
    if (!news || !community || !sidebar || !alipay || !wechat) {
      throw new Error('All announcement panels and both donation codes must be visible')
    }
    expect(community.x).toBeCloseTo(news.x)
    expect(community.y).toBeGreaterThan(news.y + news.height)
    expect(sidebar.x).toBeGreaterThan(news.x + news.width)
    expect(sidebar.y).toBeCloseTo(news.y)
    expect(wechat.y).toBeGreaterThan(alipay.y + alipay.height)
  } finally {
    await app.close()
  }
})
