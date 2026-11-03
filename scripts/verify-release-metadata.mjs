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

const publishWorkflowPath = resolve(root, '.github/workflows/publish.yml')
if (!existsSync(publishWorkflowPath)) {
  errors.push('.github/workflows/publish.yml is missing')
} else {
  const workflow = readFileSync(publishWorkflowPath, 'utf8')
  if (!workflow.includes('id-token: write'))
    errors.push('publish workflow must grant id-token: write')
  if (!workflow.includes('environment: npm-production'))
    errors.push('publish workflow must use the npm-production environment')
  if (!workflow.includes("github.event.release.tag_name == 'v1.0.0'"))
    errors.push('publish workflow must be gated to the v1.0.0 release tag')
  if (!workflow.includes("pkg.version !== '1.0.0'"))
    errors.push('publish workflow must verify package version 1.0.0')
  if (!workflow.includes('npm publish --provenance --access public'))
    errors.push('publish workflow must publish with npm provenance')
  if (!workflow.includes('types: [published]'))
    errors.push('publish workflow must only trigger on published GitHub Releases')
}

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
