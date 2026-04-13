import { Link } from 'react-router-dom'

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-gray-800">Admin Dashboard</h1>
      <div className="grid grid-cols-2 gap-4">
        {[
          { to: '/admin/members', label: 'Members', icon: '👥' },
          { to: '/admin/matches', label: 'Matches', icon: '⚽' },
          { to: '/admin/finances', label: 'Finances', icon: '💰' },
          { to: '/admin/announcements', label: 'Announcements', icon: '📢' },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="bg-white border border-gray-200 rounded-2xl p-5 text-center hover:bg-green-50 hover:border-green-200 transition-colors"
          >
            <span className="text-3xl">{item.icon}</span>
            <p className="mt-2 font-semibold text-gray-700">{item.label}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
