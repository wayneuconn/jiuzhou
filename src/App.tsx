import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthInit } from './hooks/useAuth'
import { useAuthStore } from './stores/authStore'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/layout/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import MatchDetailPage from './pages/MatchDetailPage'
import ProfilePage from './pages/ProfilePage'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminMembers from './pages/admin/AdminMembers'
import AdminPayments from './pages/admin/AdminPayments'
import AdminSettings from './pages/admin/AdminSettings'
import BindPhonePage from './pages/onboard/BindPhonePage'
import SetupProfilePage from './pages/onboard/SetupProfilePage'

// Redirects authenticated users to the right onboarding step if needed.
function OnboardGuard({ children }: { children: React.ReactNode }) {
  const { firebaseUser, userProfile, loading } = useAuthStore()
  const location = useLocation()

  if (loading) return null

  // Don't redirect if already on an onboarding route
  if (location.pathname.startsWith('/onboard')) return <>{children}</>

  if (firebaseUser) {
    // Email/Google user without a linked phone → must bind phone
    const hasPhone = firebaseUser.phoneNumber ||
      firebaseUser.providerData.some((p) => p.providerId === 'phone')
    if (!hasPhone) {
      return <Navigate to="/onboard/phone" replace />
    }

    // Profile doc exists but display name is blank → profile setup
    if (userProfile !== null && !userProfile.displayName) {
      return <Navigate to="/onboard/profile" replace />
    }
  }

  return <>{children}</>
}

function AppRoutes() {
  useAuthInit()

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* Onboarding routes (auth required, no nav bar) */}
      <Route
        path="/onboard/phone"
        element={
          <ProtectedRoute>
            <BindPhonePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/onboard/profile"
        element={
          <ProtectedRoute>
            <SetupProfilePage />
          </ProtectedRoute>
        }
      />

      {/* Main app routes */}
      <Route
        element={
          <ProtectedRoute>
            <OnboardGuard>
              <AppLayout />
            </OnboardGuard>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/matches" element={<HomePage />} />
        <Route path="/match/:matchId" element={<MatchDetailPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/members"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminMembers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/payments"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminPayments />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/settings"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminSettings />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
