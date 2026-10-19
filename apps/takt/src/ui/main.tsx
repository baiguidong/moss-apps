import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { syncAppearance } from './appearance'
import './style.css'
import './appearance.css'
const stopAppearance = syncAppearance()
window.addEventListener('pagehide', stopAppearance, { once: true })
createRoot(document.getElementById('root')!).render(<App/> )
