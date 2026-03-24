import { stdin, stdout, stderr, exit } from 'node:process'
import { chromium } from 'playwright-core'

function isLoopback(endpoint) {
  try {
    const url = new URL(endpoint)
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function ensureNoProxy(endpoint) {
  if (!isLoopback(endpoint)) return
  const loopback = 'localhost,127.0.0.1,[::1]'
  const current = process.env.NO_PROXY || process.env.no_proxy || ''
  const next = current ? `${current},${loopback}` : loopback
  process.env.NO_PROXY = next
  process.env.no_proxy = next
}

async function readStdin() {
  const chunks = []
  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function resolvePage(browser, activePageUrl, createIfMissing = true) {
  const contexts = browser.contexts()
  const pages = contexts.flatMap((context) => context.pages().map((page) => ({ context, page })))

  if (activePageUrl) {
    const exact = pages.find(({ page }) => !page.isClosed() && page.url() === activePageUrl)
    if (exact) return exact
  }

  const firstNavigated = pages.find(({ page }) => !page.isClosed() && page.url() && page.url() !== 'about:blank')
  if (firstNavigated) return firstNavigated

  const first = pages.find(({ page }) => !page.isClosed())
  if (first) return first

  if (!createIfMissing) return null

  const context = contexts[0]
  if (!context) {
    throw new Error('No browser context is available over CDP')
  }
  const page = await context.newPage()
  return { context, page }
}

async function main() {
  const raw = await readStdin()
  const input = raw ? JSON.parse(raw) : {}
  ensureNoProxy(input.endpoint)

  const browser = await chromium.connectOverCDP(input.endpoint)
  try {
    switch (input.action) {
      case 'open_tab': {
        const context = browser.contexts()[0]
        if (!context) throw new Error('No browser context is available over CDP')
        const page = await context.newPage()
        if (input.url) {
          await page.goto(input.url, { waitUntil: 'domcontentloaded' })
        }
        stdout.write(JSON.stringify({
          url: page.url(),
          title: await page.title().catch(() => ''),
        }))
        break
      }
      case 'navigate': {
        const resolved = await resolvePage(browser, input.activePageUrl)
        await resolved.page.goto(input.url, { waitUntil: 'domcontentloaded' })
        stdout.write(JSON.stringify({
          url: resolved.page.url(),
          title: await resolved.page.title().catch(() => ''),
        }))
        break
      }
      case 'snapshot': {
        const resolved = await resolvePage(browser, input.activePageUrl)
        const text = await resolved.page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '')
        stdout.write(JSON.stringify({
          url: resolved.page.url(),
          title: await resolved.page.title().catch(() => ''),
          text,
        }))
        break
      }
      case 'screenshot': {
        const resolved = await resolvePage(browser, input.activePageUrl)
        await resolved.page.screenshot({ path: input.path, fullPage: true })
        stdout.write(JSON.stringify({
          url: resolved.page.url(),
          title: await resolved.page.title().catch(() => ''),
          path: input.path,
        }))
        break
      }
      case 'click': {
        const resolved = await resolvePage(browser, input.activePageUrl)
        await resolved.page.locator(input.selector).first().click()
        stdout.write(JSON.stringify({
          url: resolved.page.url(),
          title: await resolved.page.title().catch(() => ''),
        }))
        break
      }
      case 'type': {
        const resolved = await resolvePage(browser, input.activePageUrl)
        await resolved.page.locator(input.selector).first().fill(input.text)
        stdout.write(JSON.stringify({
          url: resolved.page.url(),
          title: await resolved.page.title().catch(() => ''),
        }))
        break
      }
      case 'press_key': {
        const resolved = await resolvePage(browser, input.activePageUrl)
        await resolved.page.keyboard.press(input.key)
        stdout.write(JSON.stringify({
          url: resolved.page.url(),
          title: await resolved.page.title().catch(() => ''),
        }))
        break
      }
      case 'close_tab': {
        const target = await resolvePage(browser, input.url || input.activePageUrl, false)
        if (!target) {
          stdout.write(JSON.stringify({ closed: false }))
          break
        }
        await target.page.close()
        const next = await resolvePage(browser, null, false)
        stdout.write(JSON.stringify({
          closed: true,
          url: next?.page.url() ?? null,
          title: next ? await next.page.title().catch(() => '') : null,
        }))
        break
      }
      default:
        throw new Error(`Unsupported browser action: ${input.action}`)
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

main().catch((err) => {
  stderr.write(err instanceof Error ? err.stack || err.message : String(err))
  exit(1)
})
