import React from 'react'
import { createRoot } from 'react-dom/client'
import { EmbeddedAppView } from 'moss-core-embedded-view'
import 'moss-core-global-style'

createRoot(document.getElementById('root')).render(<EmbeddedAppView appName="moss.drive" />)
