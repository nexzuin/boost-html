import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

describe('security regression guardrails', () => {
  const runtimeSources = sourceFiles(join(process.cwd(), 'src')).map((path) => ({
    path,
    source: readFileSync(path, 'utf8'),
  }))
  const allSource = runtimeSources.map(({ source }) => source).join('\n')

  it('does not use dynamic JavaScript evaluation primitives', () => {
    expect(allSource).not.toMatch(/\beval\s*\(/)
    expect(allSource).not.toMatch(/\bnew\s+Function\s*\(/)
    expect(allSource).not.toMatch(/\bFunction\s*\(/)
  })

  it('does not use HTML string mutation sinks in runtime code', () => {
    expect(allSource).not.toMatch(/\.innerHTML\b/)
    expect(allSource).not.toMatch(/\.outerHTML\b/)
    expect(allSource).not.toMatch(/\.insertAdjacentHTML\s*\(/)
    expect(allSource).not.toMatch(/document\.write\s*\(/)
  })

  it('keeps script execution behind the explicit script handler boundary', () => {
    const controller = runtimeSources.find(({ path }) => path.endsWith('navigation/controller.ts'))
    expect(controller?.source).toContain(
      'handleResponseScripts(scripts, domContext, this.options.scriptHandler)',
    )
    expect(controller?.source).not.toContain('executeScripts(')
  })
})
