import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { useAuthStore } from '../../stores/authStore'

export default function AppLayout() {
  const { userProfile } = useAuthStore()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut(auth)
    navigate('/login')
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-green-100 text-green-700'
        : 'text-gray-600 hover:bg-gray-100'
    }`

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <span className="font-bold text-lg text-green-700">九州</span>
          <div className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Home
            </NavLink>
            {userProfile?.role === 'admin' && (
              <NavLink to="/admin" className={navLinkClass}>
                Admin
              </NavLink>
            )}
            <NavLink to="/profile" className={navLinkClass}>
              Profile
            </NavLink>
            <button
              onClick={handleSignOut}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-800"
            >
              Out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-lg mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
