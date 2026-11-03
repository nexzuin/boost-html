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

test('falls back to a native navigation after a transient network failure', async ({ page }) => {
  let failFirstRequest = true
  await page.route('**/about', async (route) => {
    if (failFirstRequest) {
      failFirstRequest = false
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  await page.goto('/')
  await page.getByRole('link', { name: 'About', exact: true }).click()

  await expect(page).toHaveURL(/\/about$/)
  await expect(page.locator('h1')).toHaveText('About')
  await expect(page.locator('.badge')).toHaveText('full page load')
})

test('cancels a superseded in-flight navigation', async ({ page }) => {
  let aboutRequestStarted = false
  let aboutRequestWasAborted = false
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname === '/about') aboutRequestWasAborted = true
  })
  await page.route('**/about', async (route) => {
    aboutRequestStarted = true
    await new Promise((resolve) => setTimeout(resolve, 900))
    try {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><title>Stale About</title></head><body><h1>Stale About</h1></body></html>',
      })
    } catch {
      // The browser may already have canceled the routed request.
    }
  })

  await page.goto('/')
  await page.getByRole('link', { name: 'About', exact: true }).click({ noWaitAfter: true })
  await expect.poll(() => aboutRequestStarted).toBe(true)
  await page.getByRole('link', { name: 'Docs (hash)' }).click({ noWaitAfter: true })

  await expect(page).toHaveURL(/\/docs#install$/)
  await expect(page.locator('h1')).toHaveText('Docs')
  await expect.poll(() => aboutRequestWasAborted).toBe(true)
  await expect(page.locator('h1')).not.toHaveText('Stale About')
})

test('keeps repeated navigation DOM bounded and Chromium heap usage stable', async ({
  page,
  browserName,
}) => {
  await page.goto('/')
  const client = browserName === 'chromium' ? await page.context().newCDPSession(page) : undefined
  if (client) {
    await client.send('HeapProfiler.enable')
    await client.send('HeapProfiler.collectGarbage')
  }
  const before = client ? await client.send('Runtime.getHeapUsage') : undefined

  for (let index = 0; index < 24; index++) {
    if (index % 2 === 0) {
      await page.getByRole('link', { name: 'About', exact: true }).click()
      await expect(page.locator('h1')).toHaveText('About')
    } else {
      await page.getByRole('link', { name: 'Home', exact: true }).click()
      await expect(page.locator('h1')).toHaveText('boost-html')
    }
  }

  await page.waitForTimeout(250)
  if (client) await client.send('HeapProfiler.collectGarbage')
  const after = client ? await client.send('Runtime.getHeapUsage') : undefined
  const domState = await page.evaluate(() => ({
    progressIndicators: document.querySelectorAll('.boost-html-progress').length,
    liveRegions: document.querySelectorAll('[role="status"][aria-live="polite"]').length,
  }))

  if (after && before) expect(after.usedSize - before.usedSize).toBeLessThan(5 * 1024 * 1024)
  expect(domState.progressIndicators).toBe(0)
  expect(domState.liveRegions).toBeLessThanOrEqual(1)
  await client?.detach()
})

test('works with strict CSP and Trusted Types without executing response scripts', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Trusted Types enforcement is currently Chromium-only')
  await page.addInitScript(() => {
    const trustedTypesApi = (
      window as Window & {
        trustedTypes?: {
          createPolicy: (
            name: string,
            rules: { createHTML: (input: string) => string },
          ) => { createHTML: (input: string) => unknown }
        }
      }
    ).trustedTypes
    const policy = trustedTypesApi?.createPolicy('boost-html-e2e', {
      createHTML: (input: string) => input,
    })
    ;(
      window as Window & {
        boostHtmlConfig?: { nonce: string; createHTML: (html: string) => unknown }
      }
    ).boostHtmlConfig = {
      nonce: 'boost-e2e-nonce',
      createHTML: (html) => policy?.createHTML(html) ?? html,
    }
  })

  await page.route('**/csp', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: {
        'content-security-policy': [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'nonce-boost-e2e-nonce'",
          "require-trusted-types-for 'script'",
          'trusted-types boost-html-e2e',
        ].join('; '),
      },
      body: '<!doctype html><html><head><title>CSP</title><script defer src="/boost-html.js"></script></head><body data-boost="true"><main><h1>CSP source</h1><a href="/csp-destination">CSP destination</a></main></body></html>',
    })
  })
  await page.route('**/csp-destination', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><title>CSP destination</title></head><body data-boost="true"><main><h1>CSP destination</h1><script>window.__cspScriptRan = true</script><button onclick="window.__cspHandlerRan = true">Unsafe handler</button><a href="javascript:window.__cspHrefRan = true">Unsafe URL</a></main></body></html>',
    })
  })

  await page.goto('/csp')
  await page.getByRole('link', { name: 'CSP destination' }).click()
  await expect(page.locator('h1')).toHaveText('CSP destination')
  const securityState = await page.evaluate(() => ({
    scriptRan: (window as Window & { __cspScriptRan?: boolean }).__cspScriptRan,
    scriptCount: document.querySelectorAll('body script').length,
    eventHandler: document.querySelector('button')?.hasAttribute('onclick'),
    unsafeHref: document.querySelector('a')?.hasAttribute('href'),
    progressNonce: document.querySelector<HTMLStyleElement>('style[data-boost-html-progress]')
      ?.nonce,
  }))

  expect(securityState.scriptRan).toBeUndefined()
  expect(securityState.scriptCount).toBe(0)
  expect(securityState.eventHandler).toBe(false)
  expect(securityState.unsafeHref).toBe(false)
  expect(securityState.progressNonce).toBe('boost-e2e-nonce')
})
