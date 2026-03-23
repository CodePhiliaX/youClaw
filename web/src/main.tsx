import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Diagnostic } from './pages/Diagnostic'
import { StartupError } from './pages/StartupError'
import { I18nProvider } from './i18n'
import { initBaseUrl } from './api/transport'
import { useAppStore } from './stores/app'
import './index.css'
import 'streamdown/styles.css'

// Add class for non-Mac platforms to override native scrollbar via CSS
if (navigator.platform && !navigator.platform.startsWith('Mac')) {
  document.documentElement.classList.add('custom-scrollbar')
}

const root = createRoot(document.getElementById('root')!)

function renderApp() {
  root.render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  )
}

function renderError() {
  root.render(
    <StrictMode>
      <I18nProvider>
        <StartupError onRetry={startup} />
      </I18nProvider>
    </StrictMode>,
  )
}

function renderDiagnostic() {
  root.render(
    <StrictMode>
      <I18nProvider>
        <Diagnostic />
      </I18nProvider>
    </StrictMode>,
  )
}

async function startup() {
  if (import.meta.env.VITE_YOUCLAW_DIAGNOSTIC === '1') {
    renderDiagnostic()
    return
  }

  const ok = await initBaseUrl()
  if (!ok) {
    renderError()
    return
  }
  await useAppStore.getState().hydrate()
  renderApp()
}

startup()
