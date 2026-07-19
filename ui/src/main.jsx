import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import logoJpg from '@assets/logo/drishyam3d_logo.jpg'

const setFavicon = () => {
  try {
    const link = document.getElementById('favicon-link')
    if (link) link.href = logoJpg
    const apple = document.getElementById('favicon-apple')
    if (apple) apple.href = logoJpg
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
