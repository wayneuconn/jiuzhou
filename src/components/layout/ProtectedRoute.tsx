import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import type { UserRole } from '../../types'

interface Props {
  children: React.ReactNode
  requiredRole?: UserRole
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const { firebaseUser, userProfile, loading } = useAuthStore()

  // No cached profile and Firebase not ready yet → show spinner
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-pitch">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-teal border-t-transparent rounded-full animate-spin" />
          <span className="text-slate text-sm font-medium">Loading...</span>
        </div>
      </div>
    )
  }

  // Firebase resolved with no user, and no cached profile to show optimistically
  if (!firebaseUser && !userProfile) return <Navigate to="/login" replace />

  if (requiredRole && userProfile?.role !== requiredRole) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
