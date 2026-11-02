import { afterEach, describe, expect, it, vi } from 'vitest'

describe('auto initialisation', () => {
  afterEach(() => {
    window.boostHtml?.stop()
    vi.resetModules()
    delete window.boostHtml
    delete window.boostHtmlConfig
  })

  it('creates and starts a default instance when the module is imported', async () => {
    vi.resetModules()
    const { getBoost } = await import('../src/index')

    expect(getBoost()).not.toBeNull()
    expect(window.boostHtml).toBe(getBoost())
    expect(getBoost()?.options.executeScripts).toBe(false)
  })

  it('reads window.boostHtmlConfig', async () => {
    vi.resetModules()
    window.boostHtmlConfig = {
      progress: false,
      scope: '.boosted',
      executeScripts: true,
      nonce: 'auto-nonce',
    }

    const { getBoost } = await import('../src/index')
    const options = getBoost()?.options

    expect(options?.progress).toBe(false)
    expect(options?.scope).toBe('.boosted')
    expect(options?.executeScripts).toBe(true)
    expect(options?.nonce).toBe('auto-nonce')
  })
})
