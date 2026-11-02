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

test('re-executes scripts only because the demo opts in', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Scripts', exact: true }).click()

  await expect(page.locator('h1')).toHaveText('Scripts')
  const ran = await page.evaluate(
    () => (window as Window & { __boostScriptRan?: boolean }).__boostScriptRan,
  )
  expect(ran).toBe(true)
})
