import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { syncAppearance } from './lib/appearance'
import './styles.css'
syncAppearance()
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
