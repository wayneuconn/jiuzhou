export function formatDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hour = d.getHours().toString().padStart(2, '0')
  const min = d.getMinutes().toString().padStart(2, '0')
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${month}月${day}日 ${weekdays[d.getDay()]} ${hour}:${min}`
}

export function formatDateShort(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  registration_r1: '会员报名中',
  registration_r2: '开放报名中',
  drafting: '抽签进行中',
  ready: '阵容已定',
  completed: '已完赛',
  cancelled: '已取消',
}

export const STATUS_BADGE: Record<string, string> = {
  draft: 'badge-grey',
  registration_r1: 'badge-blue',
  registration_r2: 'badge-green',
  drafting: 'badge-orange',
  ready: 'badge-green',
  completed: 'badge-grey',
  cancelled: 'badge-red',
}

export const REG_STATUS_LABEL: Record<string, string> = {
  confirmed: '已确认',
  waitlist: '候补',
  promoted: '待确认',
  withdrawn: '已退出',
  excused: '请假',
}
