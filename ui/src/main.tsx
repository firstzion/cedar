import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
// Ubuntu, bundled with the app (Latin and Latin-extended alphabets; add the other alphabets here if ever needed)
import '@fontsource/ubuntu/latin-400.css'
import '@fontsource/ubuntu/latin-500.css'
import '@fontsource/ubuntu/latin-700.css'
import '@fontsource/ubuntu/latin-ext-400.css'
import '@fontsource/ubuntu/latin-ext-500.css'
import '@fontsource/ubuntu/latin-ext-700.css'
import './theme.css'
import './styles.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
