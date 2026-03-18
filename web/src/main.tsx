// Polyfill ES2022+ APIs for older WebViews (Safari 13/14 on macOS 10.15–11)
import 'core-js/actual/array/at'
import 'core-js/actual/string/at'
import 'core-js/actual/object/has-own'
import 'core-js/actual/structured-clone'
import 'core-js/actual/array/find-last'
import 'core-js/actual/array/find-last-index'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import { initBaseUrl } from './api/transport'
import { useAppStore } from './stores/app'
import './index.css'
import 'streamdown/styles.css'

// Add class for non-Mac platforms to override native scrollbar via CSS
if (navigator.platform && !navigator.platform.startsWith('Mac')) {
  document.documentElement.classList.add('custom-scrollbar')
}

// Preload backend port config (read from store in Tauri mode), wait before rendering
initBaseUrl()
  .then(() => useAppStore.getState().hydrate())
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <I18nProvider>
          <App />
        </I18nProvider>
      </StrictMode>,
    )
  })
