import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getMarketplaceSkills,
  type MarketplacePage,
  type MarketplaceSkill,
  type MarketplaceSort,
  type RegistrySelectableSource,
} from '@/api/client'
import { applyMarketplaceChangeToPage, type MarketplaceChangeEvent } from '@/lib/marketplace-updates'

type MarketplaceLoadMode = 'replace' | 'refresh' | 'append'

export type MarketplaceFeedStatus = 'idle' | 'loading' | 'refreshing' | 'loading-more' | 'error'

interface UseMarketplaceFeedOptions {
  enabled: boolean
  query: string
  sort?: MarketplaceSort
  source?: RegistrySelectableSource
  limit?: number
  debounceMs?: number
  loadFailedMessage: string
}

function createEmptyMarketplacePage(
  query: string,
  sort: MarketplaceSort,
  source?: RegistrySelectableSource,
): MarketplacePage {
  return {
    items: [],
    nextCursor: null,
    source: source ?? 'fallback',
    query,
    sort,
  }
}

function mergeMarketplaceItems(current: MarketplaceSkill[], next: MarketplaceSkill[]) {
  const items = new Map(current.map((item) => [item.slug, item]))
  for (const item of next) {
    items.set(item.slug, item)
  }
  return [...items.values()]
}

export function useMarketplaceFeed({
  enabled,
  query,
  sort = 'trending',
  source,
  limit = 24,
  debounceMs = 300,
  loadFailedMessage,
}: UseMarketplaceFeedOptions) {
  const normalizedQuery = query.trim()
  const [activeQuery, setActiveQuery] = useState(normalizedQuery)
  const [pageState, setPageState] = useState<MarketplacePage>(() => (
    createEmptyMarketplacePage(normalizedQuery, sort, source)
  ))
  const [statusState, setStatusState] = useState<MarketplaceFeedStatus>('idle')
  const [error, setError] = useState('')
  const [appendError, setAppendError] = useState('')

  const pageRef = useRef(pageState)
  const statusRef = useRef(statusState)
  const filtersRef = useRef({ query: normalizedQuery, sort, source })
  const requestIdRef = useRef(0)
  const pendingCursorRef = useRef<string | null>(null)
  const wasEnabledRef = useRef(enabled)

  const setPage = useCallback((updater: MarketplacePage | ((current: MarketplacePage) => MarketplacePage)) => {
    setPageState((current) => {
      const next = typeof updater === 'function'
        ? updater(current)
        : updater
      pageRef.current = next
      return next
    })
  }, [])

  const setStatus = useCallback((next: MarketplaceFeedStatus) => {
    statusRef.current = next
    setStatusState(next)
  }, [])

  const load = useCallback(async (options: {
    mode?: MarketplaceLoadMode
    cursor?: string | null
    query?: string
    sort?: MarketplaceSort
    source?: RegistrySelectableSource
  } = {}) => {
    if (!enabled) return

    const mode = options.mode ?? 'replace'
    const append = mode === 'append'
    const nextQuery = options.query ?? filtersRef.current.query
    const nextSort = options.sort ?? filtersRef.current.sort
    const nextSource = options.source ?? filtersRef.current.source
    const cursor = append ? (options.cursor ?? pageRef.current.nextCursor) : null

    if (append) {
      if (
        !cursor
        || pendingCursorRef.current === cursor
        || statusRef.current === 'loading-more'
        || statusRef.current === 'loading'
      ) {
        return
      }
      pendingCursorRef.current = cursor
      setAppendError('')
      setStatus('loading-more')
    } else {
      pendingCursorRef.current = null
      setAppendError('')
      if (mode === 'replace') {
        setPage(createEmptyMarketplacePage(nextQuery, nextSort, nextSource))
        setStatus('loading')
        setError('')
      } else {
        setStatus('refreshing')
      }
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    try {
      const nextPage = await getMarketplaceSkills({
        source: nextSource,
        query: nextQuery,
        sort: nextSort,
        cursor,
        limit,
      })

      if (requestId !== requestIdRef.current) {
        return
      }

      pendingCursorRef.current = null
      setPage((current) => ({
        ...nextPage,
        items: append ? mergeMarketplaceItems(current.items, nextPage.items) : nextPage.items,
      }))
      setStatus('idle')
      if (!append) {
        setError('')
      }
    } catch (nextError) {
      if (requestId !== requestIdRef.current) {
        return
      }

      pendingCursorRef.current = null

      if (!append) {
        if (mode === 'refresh') {
          setStatus('idle')
          return
        }

        setPage(createEmptyMarketplacePage(nextQuery, nextSort, nextSource))
        setStatus('error')
        setError(nextError instanceof Error && nextError.message ? nextError.message : loadFailedMessage)
        return
      }

      setStatus('idle')
      setAppendError(nextError instanceof Error && nextError.message ? nextError.message : loadFailedMessage)
    }
  }, [enabled, limit, loadFailedMessage, setPage, setStatus])

  useEffect(() => {
    const delay = enabled && wasEnabledRef.current ? debounceMs : 0

    const timer = window.setTimeout(() => {
      filtersRef.current = { query: normalizedQuery, sort, source }
      setActiveQuery(normalizedQuery)

      if (!enabled) {
        wasEnabledRef.current = false
        requestIdRef.current += 1
        pendingCursorRef.current = null
        return
      }

      wasEnabledRef.current = true
      void load({
        mode: 'replace',
        query: normalizedQuery,
        sort,
        source,
      })
    }, delay)

    return () => window.clearTimeout(timer)
  }, [debounceMs, enabled, load, normalizedQuery, sort, source])

  const loadMore = useCallback(() => load({ mode: 'append' }), [load])
  const refresh = useCallback(() => load({ mode: 'refresh' }), [load])

  const applyChange = useCallback((change?: MarketplaceChangeEvent) => {
    if (!change) return
    setPage((current) => applyMarketplaceChangeToPage(current, change))
  }, [setPage])

  const updateItems = useCallback((updater: (items: MarketplaceSkill[]) => MarketplaceSkill[]) => {
    setPage((current) => ({
      ...current,
      items: updater(current.items),
    }))
  }, [setPage])

  const listKey = useMemo(
    () => `${source ?? 'fallback'}:${sort}:${activeQuery}`,
    [activeQuery, sort, source],
  )

  return {
    activeQuery,
    appendError,
    applyChange,
    error,
    listKey,
    loadMore,
    page: pageState,
    refresh,
    status: statusState,
    updateItems,
  }
}
