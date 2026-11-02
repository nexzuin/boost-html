import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs', 'iife'],
  globalName: 'BoostHtml',
  dts: true,
  sourcemap: true,
  minify: true,
  clean: true,
  target: 'es2020',
  outExtension({ format }) {
    if (format === 'cjs') return { js: '.cjs' }
    if (format === 'iife') return { js: '.global.js' }
    return { js: '.js' }
  },
})
