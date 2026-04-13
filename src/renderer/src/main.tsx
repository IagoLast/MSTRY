import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HotkeysProvider } from '@tanstack/react-hotkeys'

import '@xterm/xterm/css/xterm.css'

import { App } from './App'
import './styles.css'

// Prevent Electron from navigating to dropped files (default browser behavior).
// When files are dropped, insert their paths into the active terminal session.
document.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
})
document.addEventListener('drop', (e) => {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files?.length) return

  if (!window.electree) return

  const paths: string[] = []
  for (let i = 0; i < files.length; i++) {
    const filePath = (files[i] as File & { path?: string }).path
    if (filePath) {
      paths.push(filePath.includes(' ') ? `'${filePath}'` : filePath)
    }
  }
  if (paths.length > 0) {
    void window.electree.terminal.writeToActiveSession(paths.join(' '))
  }
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 3_000
    },
    mutations: {
      retry: false
    }
  }
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HotkeysProvider>
        <App />
      </HotkeysProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
