// Unified storage layer: Tauri -> Store (settings.json), Web -> localStorage

import { isTauri } from "@/api/transport"

const STORAGE_PREFIX = "youclaw-"

async function getTauriStore() {
  const { load } = await import("@tauri-apps/plugin-store")
  return load("settings.json")
}

export async function getItem(key: string): Promise<string | null> {
  if (isTauri) {
    try {
      const store = await getTauriStore()
      const value = await store.get<string>(key)
      return value ?? null
    } catch {
      return null
    }
  }
  return localStorage.getItem(STORAGE_PREFIX + key)
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isTauri) {
    try {
      const store = await getTauriStore()
      await store.set(key, value)
      await store.save()
    } catch { /* Silent fallback when Tauri Store is unavailable */ }
    return
  }
  localStorage.setItem(STORAGE_PREFIX + key, value)
}

export async function removeItem(key: string): Promise<void> {
  if (isTauri) {
    try {
      const store = await getTauriStore()
      await store.delete(key)
      await store.save()
    } catch { /* Silent fallback when Tauri Store is unavailable */ }
    return
  }
  localStorage.removeItem(STORAGE_PREFIX + key)
}
