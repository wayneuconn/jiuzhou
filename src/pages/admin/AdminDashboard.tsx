import { Link } from 'react-router-dom'

const items = [
  { to: '/admin/members',       label: 'Members',       subtitle: '成员管理', icon: '👥' },
  { to: '/admin/matches',       label: 'Matches',        subtitle: '赛事管理', icon: '⚽' },
  { to: '/admin/finances',      label: 'Finances',       subtitle: '财务记录', icon: '💰' },
  { to: '/admin/announcements', label: 'Announcements',  subtitle: '公告管理', icon: '📢' },
]

export default function AdminDashboard() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-white text-2xl font-black tracking-tight">Admin</h1>
        <span className="text-[10px] font-black text-gold border border-gold/30 bg-gold/10
                         px-2.5 py-1 rounded-full uppercase tracking-widest">
          九州
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="bg-navy border border-surface hover:border-teal/50 rounded-2xl p-5
                       flex flex-col items-start gap-3 transition-all duration-150 group"
          >
            <div className="w-10 h-10 rounded-xl bg-surface group-hover:bg-teal/10
                            flex items-center justify-center transition-colors text-xl">
              {item.icon}
            </div>
            <div>
              <p className="text-white font-bold text-sm">{item.label}</p>
              <p className="text-slate text-xs mt-0.5">{item.subtitle}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
