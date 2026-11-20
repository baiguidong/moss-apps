import { createRoot } from 'react-dom/client'
import { AnimationPage } from '@moss/media-engines/animation-page'
import './theme.css'
import '@moss/media-engines/animation.css'
createRoot(document.getElementById('root')!).render(<AnimationPage />)
