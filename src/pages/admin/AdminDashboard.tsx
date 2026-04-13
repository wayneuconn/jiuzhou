import { Link } from 'react-router-dom'

const items = [
  { to: '/admin/matches',  label: 'Matches',  subtitle: '开启 / 管理活动', icon: '⚽' },
  { to: '/admin/payments', label: 'Payments', subtitle: '开启 / 确认支付',  icon: '💳' },
  { to: '/admin/members',  label: 'Members',  subtitle: '成员与权限管理',   icon: '👥' },
  { to: '/admin/settings', label: 'Settings', subtitle: '赛季设置',         icon: '⚙️' },
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
