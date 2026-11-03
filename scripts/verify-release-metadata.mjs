import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const errors = []
const repositoryUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url

if (!repositoryUrl) errors.push('package.json.repository.url is missing')
if (!pkg.homepage) errors.push('package.json.homepage is missing')
if (!pkg.bugs?.url) errors.push('package.json.bugs.url is missing')
if (pkg.publishConfig?.provenance !== true) errors.push('publishConfig.provenance must be true')
if (pkg.license !== 'MIT' || !existsSync(resolve(root, 'LICENSE')))
  errors.push('MIT license metadata and LICENSE file must both be present')
if (!pkg.files?.includes('docs/MIGRATION.md'))
  errors.push('docs/MIGRATION.md must be included in the package files whitelist')

if (repositoryUrl) {
  const normalized = repositoryUrl
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
  if (!/^https:\/\/(github\.com|gitlab\.com)\//.test(normalized)) {
    errors.push(
      'repository.url must be a public HTTPS GitHub or GitLab repository URL for npm provenance',
    )
  }
  if (pkg.homepage && !pkg.homepage.startsWith(normalized)) {
    errors.push('homepage must refer to the configured repository')
  }
  if (pkg.bugs?.url && !pkg.bugs.url.startsWith(`${normalized}/`)) {
    errors.push('bugs.url must refer to the configured repository')
  }
}

if (errors.length) {
  console.error('Release metadata validation BLOCKED:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`Release metadata validation passed for ${pkg.name}@${pkg.version}.`)
