import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const require = createRequire(import.meta.url)
const fail = (message) => {
  console.error(`Package verification failed: ${message}`)
  process.exitCode = 1
}

const buildConfig = readFileSync(resolve(root, 'tsup.config.ts'), 'utf8')
if (!/minify:\s*true/.test(buildConfig)) fail('production build is not configured as minified')
if (!/dts:\s*true/.test(buildConfig)) fail('TypeScript declaration generation is disabled')
if (!/format:\s*\[[\s\S]*?esm[\s\S]*?cjs[\s\S]*?iife/.test(buildConfig)) {
  fail('build does not declare ESM, CJS, and IIFE formats')
}

const targets = new Set()
for (const [subpath, conditions] of Object.entries(packageJson.exports ?? {})) {
  if (subpath === './package.json') continue
  for (const condition of ['import', 'require']) {
    const target = conditions?.[condition]?.default
    const types = conditions?.[condition]?.types
    if (!target || !types) {
      fail(`${subpath} is missing ${condition} runtime or type export`)
      continue
    }
    targets.add(target)
    targets.add(types)
  }
}
for (const target of [
  packageJson.main,
  packageJson.module,
  packageJson.types,
  packageJson.unpkg,
  packageJson.jsdelivr,
]) {
  if (target) targets.add(target)
}
for (const target of packageJson.sideEffects ?? []) targets.add(target)
for (const target of targets) {
  if (!existsSync(resolve(root, target))) fail(`declared target does not exist: ${target}`)
}

for (const [subpath, conditions] of Object.entries(packageJson.exports ?? {})) {
  if (subpath === './package.json') continue
  const esmPath = conditions?.import?.default
  const cjsPath = conditions?.require?.default
  if (esmPath && existsSync(resolve(root, esmPath))) {
    const namespace = await import(pathToFileURL(resolve(root, esmPath)).href)
    if (typeof namespace.createBoost !== 'function')
      fail(`${subpath} ESM export does not expose createBoost()`)
  }
  if (cjsPath && existsSync(resolve(root, cjsPath))) {
    const namespace = require(resolve(root, cjsPath))
    if (typeof namespace.createBoost !== 'function')
      fail(`${subpath} CJS export does not expose createBoost()`)
  }
}

for (const declaration of [
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/core.d.ts',
  'dist/core.d.cts',
]) {
  if (existsSync(resolve(root, declaration))) {
    const contents = readFileSync(resolve(root, declaration), 'utf8')
    if (!contents.includes('createBoost')) fail(`${declaration} does not declare createBoost`)
    if (statSync(resolve(root, declaration)).size === 0) fail(`${declaration} is empty`)
  }
}

const tarballOutput = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
const [tarball] = JSON.parse(tarballOutput)
const packed = new Set((tarball?.files ?? []).map((file) => file.path))
const requiredPackageFiles = [
  'package.json',
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'CHANGELOG.md',
  'docs/API.md',
  'docs/SECURITY.md',
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/core.js',
  'dist/core.cjs',
  'dist/core.d.ts',
  'dist/core.d.cts',
  'dist/index.global.js',
]
for (const file of requiredPackageFiles) {
  if (!packed.has(file)) fail(`required file is missing from package contents: ${file}`)
}
for (const file of packed) {
  if (/^(?:tests|e2e|benchmarks|\.github|scripts)\//.test(file)) {
    fail(`development-only file leaked into package: ${file}`)
  }
}
if (!packageJson.license || !existsSync(resolve(root, 'LICENSE')))
  fail('license metadata or LICENSE file is missing')
if (!packageJson.description) fail('package description is missing')

if (process.exitCode) process.exit(process.exitCode)
console.log(
  `Package verification passed: ${packed.size} files, ${tarball.size} bytes, ESM/CJS exports and declarations validated.`,
)
