import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import { ProtectedRoute } from './components/ProtectedRoute'
import { BottomNav } from './components/BottomNav'
import { Login } from './pages/Login'
import { Register } from './pages/Register'
import { Onboarding } from './pages/Onboarding'
import { Dashboard } from './pages/Dashboard'
import { Training } from './pages/Training'
import { Nutrition } from './pages/Nutrition'

// Placeholder pages for Phase 1B+
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4 pb-20">
      <div className="text-center">
        <h2 className="text-xl font-bold text-white">{title}</h2>
        <p className="text-zinc-500 text-sm mt-2">Coming soon</p>
      </div>
    </div>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BottomNav />
    </>
  )
}

function App() {
  const { user } = useAuthStore()

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route
          path="/login"
          element={user ? <Navigate to={user.onboarding_complete ? '/' : '/onboarding'} replace /> : <Login />}
        />
        <Route
          path="/register"
          element={user ? <Navigate to={user.onboarding_complete ? '/' : '/onboarding'} replace /> : <Register />}
        />

        {/* Onboarding — authenticated but not yet complete */}
        <Route
          path="/onboarding"
          element={
            !user ? (
              <Navigate to="/login" replace />
            ) : user.onboarding_complete ? (
              <Navigate to="/" replace />
            ) : (
              <Onboarding />
            )
          }
        />

        {/* Protected app routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell>
                <Dashboard />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/training"
          element={
            <ProtectedRoute>
              <AppShell>
                <Training />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/nutrition"
          element={
            <ProtectedRoute>
              <AppShell>
                <Nutrition />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/body"
          element={
            <ProtectedRoute>
              <AppShell>
                <PlaceholderPage title="Body" />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/ask"
          element={
            <ProtectedRoute>
              <AppShell>
                <PlaceholderPage title="Ask" />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <AppShell>
                <PlaceholderPage title="Settings" />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App