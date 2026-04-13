import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
      <path d="M9 21V12h6v9"/>
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z"/>
    </svg>
  )
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <circle cx="12" cy="8" r="4"/>
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
      <rect x="3" y="3" width="7" height="7" rx="1"/>
      <rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/>
      <rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  )
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-col items-center gap-0.5 px-5 py-2 rounded-xl transition-all duration-150
   ${isActive ? 'text-teal' : 'text-slate hover:text-white'}`

export default function BottomTabBar() {
  const { userProfile } = useAuthStore()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-navy/95 backdrop-blur-md border-t border-surface"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-lg mx-auto flex items-center justify-around h-16">
        <NavLink to="/" end className={linkClass}>
          <HomeIcon />
          <span className="text-[10px] font-bold tracking-wide">Home</span>
        </NavLink>

        <NavLink to="/matches" className={linkClass}>
          <ShieldIcon />
          <span className="text-[10px] font-bold tracking-wide">Matches</span>
        </NavLink>

        <NavLink to="/profile" className={linkClass}>
          <UserIcon />
          <span className="text-[10px] font-bold tracking-wide">Profile</span>
        </NavLink>

        {userProfile?.role === 'admin' && (
          <NavLink to="/admin" className={linkClass}>
            <GridIcon />
            <span className="text-[10px] font-bold tracking-wide">Admin</span>
          </NavLink>
        )}
      </div>
    </nav>
  )
}
