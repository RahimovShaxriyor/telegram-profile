import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { Toaster } from 'sonner'
import { AuthGate } from './components/layout/AuthGate'
import { AppShell } from './components/layout/AppShell'
import { TooltipProvider } from './components/ui/primitives'
import { ApiError } from './lib/api'
import { ThemeProvider, useTheme } from './lib/theme'
import { Dashboard } from './pages/Dashboard'
import { NotFound } from './pages/NotFound'

const Account = lazy(() => import('./pages/Account'))
const Messages = lazy(() => import('./pages/Messages'))
const Groups = lazy(() => import('./pages/Groups'))
const Channels = lazy(() => import('./pages/Channels'))
const Automation = lazy(() => import('./pages/Automation'))
const ActivityPage = lazy(() => import('./pages/Activity'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const ArchivePage = lazy(() => import('./pages/Archive'))
const AdminPage = lazy(() => import('./pages/Admin'))

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // 4xx are definitive answers (no rights, not connected); only retry transient failures.
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
    },
  })
}

function ThemedToaster() {
  const { resolved } = useTheme()
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      closeButton
      toastOptions={{ classNames: { toast: '!rounded-xl !border-border !shadow-md !font-sans' } }}
    />
  )
}

export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          {children}
          <ThemedToaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export function AppRoutes() {
  return (
    <AuthGate>
      <AppShell>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/account" element={<Account />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/automation" element={<Automation />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </AppShell>
    </AuthGate>
  )
}

export default function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  )
}
