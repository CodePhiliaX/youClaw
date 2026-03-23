/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_YOUCLAW_DIAGNOSTIC?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
