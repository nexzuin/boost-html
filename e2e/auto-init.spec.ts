import { expect, test } from '@playwright/test'

test('auto-initialises and exposes the public handle', async ({ page }) => {
  await page.goto('/')

  const result = await page.evaluate(() => {
    const handle = (window as Window & { boostHtml?: { options: { executeScripts: boolean } } })
      .boostHtml
    return {
      hasHandle: Boolean(handle),
      scriptsOptIn: handle?.options.executeScripts,
    }
  })

  expect(result.hasHandle).toBe(true)
  expect(result.scriptsOptIn).toBe(false)
})
