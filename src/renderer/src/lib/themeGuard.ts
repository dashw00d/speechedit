/** Fail if chrome is styled outside themes/*.css semantic tokens. */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const RENDERER = dirname(dirname(fileURLToPath(import.meta.url)))
const THEMES_DIR = join(RENDERER, 'themes')
const STYLES = join(RENDERER, 'styles.css')

const SCALE = /var\(--(?:brand|accent|highlight|success|warning|danger)-\d+\)/
const HEX = /#(?:[0-9a-fA-F]{3,8})\b/
const RGB = /\brgba?\s*\(/
const HSL = /\bhsla?\s*\(/
const FONT = /font-family:\s*([^;]+)/
const NAMED = /(?<![-\w])(?:color|background|background-color|border-color|outline-color|fill|stroke)\s*:\s*(?:white|black|red|blue|green|yellow|orange|purple|pink|gray|grey|navy|teal|gold)\b/i
const TOKEN = /var\(--([a-z0-9-]+)/g

const ALLOW_HEX = new Set([
  'lib/theme.ts',
  'lib/themeGuard.ts',
  'lib/themeGuard.test.ts'
])

export interface ThemeViolation {
  file: string
  line: number
  rule: string
  snippet: string
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'out') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

function stripComments(source: string, css: boolean) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
  if (css) return stripped
  return stripped.replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function rel(file: string) {
  return relative(RENDERER, file).replaceAll('\\', '/')
}

function add(hits: ThemeViolation[], file: string, source: string, re: RegExp, rule: string) {
  const lines = source.split('\n')
  lines.forEach((line, i) => {
    if (re.test(line)) hits.push({ file: rel(file), line: i + 1, rule, snippet: line.trim() })
  })
}

function tokensIn(source: string): Set<string> {
  const found = new Set<string>()
  for (const match of source.matchAll(TOKEN)) found.add(match[1])
  return found
}

function definedTokens(source: string): Set<string> {
  const found = new Set<string>()
  for (const match of source.matchAll(/--([a-z0-9-]+)\s*:/g)) found.add(match[1])
  return found
}

export function lintTheme(root = RENDERER): ThemeViolation[] {
  const hits: ThemeViolation[] = []
  const styles = stripComments(readFileSync(STYLES, 'utf8'), true)
  add(hits, STYLES, styles, HEX, 'hex color in styles.css — put it on a theme token')
  add(hits, STYLES, styles, RGB, 'rgb() in styles.css — use a theme token')
  add(hits, STYLES, styles, HSL, 'hsl() in styles.css — use a theme token')
  add(hits, STYLES, styles, SCALE, 'palette scale token in styles.css — use a semantic --color-* token')
  add(hits, STYLES, styles, NAMED, 'named color in styles.css — use a theme token')
  styles.split('\n').forEach((line, i) => {
    const match = line.match(FONT)
    if (!match) return
    const value = match[1].trim()
    if (/^var\(--/.test(value) || /^(inherit|serif|sans-serif|monospace)$/.test(value)) return
    hits.push({
      file: rel(STYLES),
      line: i + 1,
      rule: 'font-family must be var(--font-*)',
      snippet: line.trim()
    })
  })

  const needed = tokensIn(styles)
  const themeFiles = readdirSync(THEMES_DIR)
    .filter((name) => name.endsWith('.css'))
    .map((name) => join(THEMES_DIR, name))
  if (themeFiles.length === 0) {
    hits.push({ file: 'themes', line: 1, rule: 'no theme files', snippet: THEMES_DIR })
  }
  for (const file of themeFiles) {
    const defined = definedTokens(readFileSync(file, 'utf8'))
    for (const token of needed) {
      if (!defined.has(token)) {
        hits.push({
          file: rel(file),
          line: 1,
          rule: `theme is missing --${token} used by styles.css`,
          snippet: `--${token}`
        })
      }
    }
  }

  for (const file of walk(root)) {
    const path = rel(file)
    if (!/\.(tsx|ts|css)$/.test(path)) continue
    if (path.endsWith('.test.ts') || path.startsWith('themes/')) continue
    if (path === 'styles.css' || path === 'theme.css') continue
    if (ALLOW_HEX.has(path)) continue
    const source = stripComments(readFileSync(file, 'utf8'), path.endsWith('.css'))
    add(hits, file, source, HEX, 'hex color outside themes/ — use theme.ts or a CSS token')
    add(hits, file, source, RGB, 'rgb() outside themes/ — use a CSS token')
  }

  return hits
}

export function formatThemeViolations(hits: ThemeViolation[]) {
  return hits.map((hit) => `${hit.file}:${hit.line}  ${hit.rule}\n  ${hit.snippet}`).join('\n')
}

if (import.meta.main) {
  const hits = lintTheme()
  if (hits.length) {
    console.error(formatThemeViolations(hits))
    process.exit(1)
  }
  console.log('theme guard: ok')
}
