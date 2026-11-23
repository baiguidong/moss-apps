import { createRoot } from 'react-dom/client'
import App from './App'
import '@moss/engine-apps/styles.css'
import './studio.css'
import './workbench.css'
createRoot(document.getElementById('root')!).render(<App />)
