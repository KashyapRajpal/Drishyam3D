import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import logoPng from '@assets/logo/drishyam3d_logo.png'

const setFavicon = () => {
  try {
    const link = document.getElementById('favicon-link')
    if (link) link.href = logoPng
    const apple = document.getElementById('favicon-apple')
    if (apple) apple.href = logoPng
  } catch (e) {
    // no-op
  }
}

setFavicon()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
