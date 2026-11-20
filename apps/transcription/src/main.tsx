import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@moss/local-tasks/styles.css'
import '@moss/media-engines/transcription.css'
createRoot(document.getElementById('root')!).render(<App />)
