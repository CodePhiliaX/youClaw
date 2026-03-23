import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

if (navigator.platform && !navigator.platform.startsWith('Mac')) {
  document.documentElement.classList.add('custom-scrollbar')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
