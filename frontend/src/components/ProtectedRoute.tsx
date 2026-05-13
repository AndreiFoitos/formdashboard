import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

export function ProtectedRoute({ children }: Props) {
  const { user } = useAuthStore()

  if (!user) return <Navigate to="/login" replace />
  if (!user.onboarding_complete) return <Navigate to="/onboarding" replace />

  return <>{children}</>
}