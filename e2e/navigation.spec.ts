import { expect, test } from '@playwright/test'

test('boosts link navigation without a full page load', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    ;(window as Window & { __stay?: string }).__stay = 'kept'
  })

  await page.getByRole('link', { name: 'About', exact: true }).click()

  await expect(page).toHaveURL(/\/about$/)
  await expect(page.locator('h1')).toHaveText('About')
  await expect(page.locator('.badge')).toHaveText('boosted request')
  expect(await page.evaluate(() => (window as Window & { __stay?: string }).__stay)).toBe('kept')
})

test('preserves back and forward navigation', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'About', exact: true }).click()
  await expect(page.locator('h1')).toHaveText('About')

  await page.goBack()
  await expect(page.locator('h1')).toHaveText('boost-html')

  await page.goForward()
  await expect(page.locator('h1')).toHaveText('About')
})

test('submits a boosted POST form and follows the redirect', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('POST form').fill('Grace')
  await page.getByRole('button', { name: 'Say hello' }).click()

  await expect(page).toHaveURL(/\/greet\?name=Grace$/)
  await expect(page.locator('h1')).toHaveText('Hello, Grace!')
  await expect(page.locator('.badge')).toHaveText('boosted request')
})

test('falls back to a full navigation for a 500 response', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /A 500 response/ }).click()

  await expect(page).toHaveURL(/\/broken$/)
  await expect(page.locator('h1')).toContainText('500')
  await expect(page.locator('.badge')).toHaveText('full page load')
})

test('navigates to a hash target', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Docs (hash)' }).click()

  await expect(page).toHaveURL(/\/docs#install$/)
  await expect(page.locator('#install')).toBeInViewport()
})

test('does not execute inline scripts from a boosted response', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Scripts', exact: true }).click()

  await expect(page.locator('h1')).toHaveText('Scripts')
  const ran = await page.evaluate(
    () => (window as Window & { __boostScriptRan?: boolean }).__boostScriptRan,
  )
  expect(ran).toBeUndefined()
  await expect(page.locator('body script')).toHaveCount(0)
})

test('preserves uploaded files in a boosted multipart form', async ({ page }) => {
  await page.route('**/upload', async (route) => {
    const request = route.request()
    expect(request.method()).toBe('POST')
    expect(request.headers()['content-type']).toContain('multipart/form-data')
    expect(request.postDataBuffer()?.toString('latin1')).toContain('report.txt')
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><title>Uploaded</title></head><body><h1>Upload complete</h1></body></html>',
    })
  })

  await page.goto('/')
  await page.locator('body').evaluate((body) => {
    const form = document.createElement('form')
    form.action = '/upload'
    form.method = 'post'
    form.enctype = 'multipart/form-data'
    form.innerHTML = '<input type="file" name="upload"><button>Upload</button>'
    body.append(form)
  })
  await page.locator('input[type=file]').setInputFiles({
    name: 'report.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('payload'),
  })
  await page.getByRole('button', { name: 'Upload' }).click()
  await expect(page.locator('h1')).toHaveText('Upload complete')
})

test('replaces only the configured response target', async ({ page }) => {
  await page.route('**/partial', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><title>Partial</title></head><body><main id="partial-content"><h1>Partial update</h1></main></body></html>',
    })
  })

  await page.goto('/')
  await page.evaluate(() => {
    const link = document.createElement('a')
    link.href = '/partial'
    link.textContent = 'Partial'
    document.querySelector('nav')?.append(link)
    const main = document.createElement('main')
    main.id = 'partial-content'
    main.innerHTML = '<p>Before</p>'
    document.body.append(main)
    ;(
      window as Window & { boostHtml?: { options: { target: (doc?: Document) => Element | null } } }
    ).boostHtml!.options.target = (doc) => doc?.querySelector('#partial-content') ?? null
  })

  await page.getByRole('link', { name: 'Partial' }).click()
  await expect(page.locator('#partial-content h1')).toHaveText('Partial update')
  await expect(page.locator('nav')).toBeVisible()
  await expect(page).toHaveTitle('Partial')
})

test('restores the previous scroll position when returning with browser back', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = 'body { min-height: 3000px; }'
    document.head.append(style)
    window.scrollTo(0, 680)
  })
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500)

  await page.evaluate(() => {
    document
      .querySelector<HTMLAnchorElement>('a[href="/about"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  })
  await expect(page).toHaveURL(/\/about$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500)
})

test('supports keyboard activation and announces the destination', async ({ page }) => {
  await page.goto('/')
  const about = page.getByRole('link', { name: 'About', exact: true })
  await about.focus()
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/\/about$/)
  await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText('About')
  await expect(page.locator('main, h1').first()).toBeFocused()
})
