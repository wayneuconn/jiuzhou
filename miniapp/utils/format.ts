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
  draft:           '草稿',
  registration_r1: '报名 R1',
  registration_r2: '报名 R2',
  drafting:        '选人中',
  ready:           '已就绪',
  completed:       '已结束',
  cancelled:       '已取消',
}

export const STATUS_BADGE: Record<string, string> = {
  draft:           'badge-grey',
  registration_r1: 'badge-teal',
  registration_r2: 'badge-teal',
  drafting:        'badge-gold',
  ready:           'badge-teal',
  completed:       'badge-grey',
  cancelled:       'badge-red',
}

export const REG_STATUS_LABEL: Record<string, string> = {
  confirmed: '已确认',
  waitlist:  '候补',
  promoted:  '待确认',
  withdrawn: '已退出',
  excused:   '请假',
}

// ── Card tier utils ──────────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS = { bronze: 1, silver: 5, gold: 15, blue: 30 }

export function getCardTier(count: number, thresholds = DEFAULT_THRESHOLDS): string {
  if (count >= thresholds.blue)   return 'blue'
  if (count >= thresholds.gold)   return 'gold'
  if (count >= thresholds.silver) return 'silver'
  if (count >= thresholds.bronze) return 'bronze'
  return 'none'
}

export function getNextTierInfo(
  count: number,
  thresholds = DEFAULT_THRESHOLDS,
): { gamesLeft: number; tier: string } | null {
  if (count >= thresholds.blue)   return null
  if (count >= thresholds.gold)   return { gamesLeft: thresholds.blue   - count, tier: 'blue' }
  if (count >= thresholds.silver) return { gamesLeft: thresholds.gold   - count, tier: 'gold' }
  if (count >= thresholds.bronze) return { gamesLeft: thresholds.silver - count, tier: 'silver' }
  return                                 { gamesLeft: thresholds.bronze - count, tier: 'bronze' }
}

export const TIER_COLOR: Record<string, string> = {
  blue:   '#4F90E1',
  gold:   '#F0B429',
  silver: '#A8A9AD',
  bronze: '#B87333',
  none:   '#00C9A7',
}

export const TIER_LABEL: Record<string, string> = {
  blue: '蓝卡', gold: '金卡', silver: '银卡', bronze: '铜卡', none: '',
}
