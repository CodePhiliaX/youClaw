import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import { initBaseUrl } from './api/transport'
import './index.css'
import 'streamdown/styles.css'

// 非 Mac 平台加 class，用于 CSS 覆盖原生滚动条
if (navigator.platform && !navigator.platform.startsWith('Mac')) {
  document.documentElement.classList.add('custom-scrollbar')
}

// 预加载后端端口配置（Tauri 模式从 store 读取）
initBaseUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
