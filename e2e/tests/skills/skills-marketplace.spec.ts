import {
  test,
  expect,
  createMarketplaceSkill,
  fulfillJson,
  openMarketplace,
} from './helpers'

test.describe('Skills marketplace', () => {
  test('loads marketplace items and auto-loads the next page on scroll', async ({ page }) => {
    let searchPageTwoRequests = 0

    await page.route('**/api/registry/marketplace**', async (route) => {
      const url = new URL(route.request().url())
      const query = url.searchParams.get('q') ?? ''
      const cursor = url.searchParams.get('cursor')

      if (query === 'browser' && cursor === 'page-2') {
        searchPageTwoRequests += 1
        await fulfillJson(route, {
          items: [
            createMarketplaceSkill({
              slug: 'browser-automation',
              displayName: 'Browser Automation',
              tags: ['browser'],
            }),
          ],
          nextCursor: null,
          source: 'clawhub',
          query: 'browser',
          sort: 'trending',
        })
        return
      }

      if (query === 'browser') {
        await fulfillJson(route, {
          items: [
            createMarketplaceSkill({
              slug: 'agent-browser',
              displayName: 'Agent Browser',
              tags: ['browser'],
            }),
          ],
          nextCursor: 'page-2',
          source: 'clawhub',
          query: 'browser',
          sort: 'trending',
        })
        return
      }

      await fulfillJson(route, {
        items: [createMarketplaceSkill({ slug: 'coding', displayName: 'Coding' })],
        nextCursor: null,
        source: 'clawhub',
        query: '',
        sort: 'trending',
      })
    })

    await openMarketplace(page)

    await expect(page.getByTestId('marketplace-card-coding')).toBeVisible()
    await expect(page.getByTestId('marketplace-disclaimer')).toBeVisible()

    const searchResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.url().includes('/api/registry/marketplace')
        && response.request().method() === 'GET'
        && (url.searchParams.get('q') ?? '') === 'browser'
        && !url.searchParams.get('cursor')
    })

    await page.getByTestId('marketplace-search-input').fill('browser')
    await searchResponsePromise

    await expect(page.getByTestId('marketplace-card-agent-browser')).toBeVisible()
    await expect(page.getByTestId('marketplace-card-coding')).toHaveCount(0)

    const scroller = page.getByTestId('marketplace-results-scroller')
    await expect(scroller).toBeVisible()

    const secondPageResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.url().includes('/api/registry/marketplace')
        && response.request().method() === 'GET'
        && (url.searchParams.get('q') ?? '') === 'browser'
        && url.searchParams.get('cursor') === 'page-2'
    })

    await scroller.evaluate((node) => {
      node.scrollTop = node.scrollHeight
      node.dispatchEvent(new Event('scroll'))
    })

    await secondPageResponsePromise
    await expect(page.getByTestId('marketplace-card-browser-automation')).toBeVisible()
    await expect.poll(() => searchPageTwoRequests).toBe(1)
  })

  test('searches marketplace results without a submit button', async ({ page }) => {
    await page.route('**/api/registry/marketplace**', async (route) => {
      const url = new URL(route.request().url())
      const query = url.searchParams.get('q') ?? ''

      if (query === 'browser') {
        await fulfillJson(route, {
          items: [
            createMarketplaceSkill({
              slug: 'agent-browser',
              displayName: 'Agent Browser',
              tags: ['browser'],
            }),
          ],
          nextCursor: null,
          source: 'clawhub',
          query: 'browser',
          sort: 'trending',
        })
        return
      }

      await fulfillJson(route, {
        items: [createMarketplaceSkill({ slug: 'coding', displayName: 'Coding' })],
        nextCursor: null,
        source: 'clawhub',
        query: '',
        sort: 'trending',
      })
    })

    await openMarketplace(page)
    await expect(page.getByTestId('marketplace-card-coding')).toBeVisible()

    const searchResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.url().includes('/api/registry/marketplace')
        && response.request().method() === 'GET'
        && (url.searchParams.get('q') ?? '') === 'browser'
        && !url.searchParams.get('cursor')
    })

    await page.getByTestId('marketplace-search-input').fill('browser')
    await searchResponsePromise

    await expect(page.getByTestId('marketplace-card-agent-browser')).toBeVisible()
    await expect(page.getByTestId('marketplace-card-coding')).toHaveCount(0)
  })

  test('keeps the disclaimer in the content flow while scrolling', async ({ page }) => {
    await page.route('**/api/registry/marketplace**', async (route) => {
      const url = new URL(route.request().url())
      const query = url.searchParams.get('q') ?? ''

      if (query === 'browser') {
        await fulfillJson(route, {
          items: Array.from({ length: 18 }, (_, index) => (
            createMarketplaceSkill({
              slug: `browser-${index + 1}`,
              displayName: `Browser ${index + 1}`,
              tags: ['browser'],
            })
          )),
          nextCursor: null,
          source: 'clawhub',
          query: 'browser',
          sort: 'trending',
        })
        return
      }

      await fulfillJson(route, {
        items: [createMarketplaceSkill({ slug: 'coding', displayName: 'Coding' })],
        nextCursor: null,
        source: 'clawhub',
        query: '',
        sort: 'trending',
      })
    })

    await openMarketplace(page)
    await expect(page.getByTestId('marketplace-disclaimer')).toBeVisible()

    const searchResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.url().includes('/api/registry/marketplace')
        && response.request().method() === 'GET'
        && (url.searchParams.get('q') ?? '') === 'browser'
        && !url.searchParams.get('cursor')
    })

    await page.getByTestId('marketplace-search-input').fill('browser')
    await searchResponsePromise

    const disclaimer = page.getByTestId('marketplace-disclaimer')
    const scroller = page.getByTestId('marketplace-results-scroller')

    await expect(disclaimer).toBeVisible()

    await scroller.evaluate((node) => {
      node.scrollTop = Math.max(0, node.scrollHeight / 2)
      node.dispatchEvent(new Event('scroll'))
    })

    await expect(disclaimer).not.toBeInViewport()
  })

  test('installs and uninstalls a marketplace skill', async ({ page }) => {
    let installed = false

    await page.route('**/api/registry/marketplace**', async (route) => {
      await fulfillJson(route, {
        items: [
          createMarketplaceSkill({
            slug: 'coding',
            displayName: 'Coding',
            installed,
            installSource: installed ? 'clawhub' : undefined,
            installedVersion: installed ? '1.2.0' : undefined,
          }),
        ],
        nextCursor: null,
        source: 'clawhub',
        query: '',
        sort: 'trending',
      })
    })

    await page.route('**/api/registry/install', async (route) => {
      installed = true
      await fulfillJson(route, { ok: true })
    })

    await page.route('**/api/registry/uninstall', async (route) => {
      installed = false
      await fulfillJson(route, { ok: true })
    })

    await openMarketplace(page)

    await page.getByTestId('marketplace-install-coding').click()
    await expect(page.getByTestId('marketplace-uninstall-coding')).toBeVisible()
    await expect(page.getByTestId('marketplace-installed-badge-coding')).toBeVisible()

    await page.getByTestId('marketplace-uninstall-coding').click()
    await expect(page.getByTestId('marketplace-install-coding')).toBeVisible()
  })

  test('updates an installed marketplace skill', async ({ page }) => {
    let installedVersion = '1.0.0'
    const latestVersion = '1.2.0'

    await page.route('**/api/registry/marketplace**', async (route) => {
      await fulfillJson(route, {
        items: [
          createMarketplaceSkill({
            slug: 'coding',
            displayName: 'Coding',
            installed: true,
            installSource: 'clawhub',
            installedVersion,
            latestVersion,
            hasUpdate: installedVersion !== latestVersion,
          }),
        ],
        nextCursor: null,
        source: 'clawhub',
        query: '',
        sort: 'trending',
      })
    })

    await page.route('**/api/registry/update', async (route) => {
      installedVersion = latestVersion
      await fulfillJson(route, { ok: true })
    })

    await openMarketplace(page)

    await expect(page.getByTestId('marketplace-update-coding')).toBeVisible()
    await expect(page.getByTestId('marketplace-update-badge-coding')).toBeVisible()

    await page.getByTestId('marketplace-update-coding').click()

    await expect(page.getByTestId('marketplace-update-coding')).toHaveCount(0)
    await expect(page.getByTestId('marketplace-installed-version-coding')).toContainText('1.2.0')
  })
})
