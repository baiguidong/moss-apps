import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { syncAppearance } from './lib/appearance'
syncAppearance()
createRoot(document.getElementById('root')!).render(<App />)
