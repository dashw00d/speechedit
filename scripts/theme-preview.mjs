import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('/home/ryan/.npm/_npx/e41f203b7505f1fb/node_modules/playwright')
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const themes = ['dashwood', 'party']

const browser = await chromium.launch({
  headless: true,
  executablePath:
    '/home/ryan/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

async function loadDemo() {
  await page.getByRole('button', { name: 'File' }).click()
  const demo = page.getByRole('button', { name: 'Studio demo' })
  if (await demo.isVisible()) await demo.click()
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.mouse.move(8, 8)
  await page.locator('.workspace').click({ position: { x: 40, y: 40 } })
  await page.waitForTimeout(200)
}

for (const theme of themes) {
  await page.goto(`http://127.0.0.1:5173/?theme=${theme}`, { waitUntil: 'networkidle' })
  await page.evaluate((id) => {
    localStorage.setItem('speechedit:theme', id)
    document.documentElement.dataset.theme = id
  }, theme)
  await page.reload({ waitUntil: 'networkidle' })
  await loadDemo()
  await page.mouse.move(720, 420)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  const path = join(root, `.theme-preview-${theme}-v8.png`)
  await page.screenshot({ path, fullPage: false })
  console.log('wrote', path)
  await page.evaluate(() => window.dispatchEvent(new Event('speechedit:preferences')))
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(root, `.theme-preview-${theme}-prefs.png`), fullPage: false })
  console.log('wrote prefs', theme)
}

await browser.close()
