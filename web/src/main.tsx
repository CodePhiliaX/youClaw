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
