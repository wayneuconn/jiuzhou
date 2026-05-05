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

// ── Markdown → HTML (for rich-text component) ────────────────────────────────

const ESC = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function mdInline(s: string): string {
  return ESC(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#e8f0eb;font-weight:700;">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code style="background:#1A2535;padding:0 6px;border-radius:6px;font-family:monospace;">$1</code>')
}

const MD_H: Record<number, string> = { 1: '34rpx', 2: '30rpx', 3: '26rpx' }
const P  = 'color:#7A8FA6;font-size:26rpx;line-height:1.7;margin:2px 0;'
const PS = 'color:#7A8FA6;font-size:24rpx;line-height:1.7;margin:2px 0;padding-left:24px;'

export function markdownToHtml(md: string): string {
  if (!md) return ''
  const parts: string[] = []
  let prevEmpty = false

  for (const line of md.split('\n')) {
    const hm  = line.match(/^(#{1,3}) (.+)/)
    const om  = line.match(/^(\d+)\. (.+)/)         // ordered: "7. text"
    const um  = line.match(/^[*-] (.+)/)              // unordered: "- text"
    const sub = line.match(/^ {1,6}[*-] (.+)/)        // indented bullet: "   - text"
    const hr  = /^---+$/.test(line.trim())
    const empty = line.trim() === ''

    if (empty) {
      if (!prevEmpty) parts.push('<br/>')
      prevEmpty = true
      continue
    }
    prevEmpty = false

    if (hm) {
      const lv = hm[1].length
      parts.push(`<h${lv} style="color:#e8f0eb;font-size:${MD_H[lv]};font-weight:700;margin:14px 0 4px;">${mdInline(hm[2])}</h${lv}>`)
    } else if (om) {
      parts.push(`<p style="${P}"><span style="color:#e8f0eb;font-weight:600;">${om[1]}.</span> ${mdInline(om[2])}</p>`)
    } else if (sub) {
      parts.push(`<p style="${PS}">• ${mdInline(sub[1])}</p>`)
    } else if (um) {
      parts.push(`<p style="${P}">• ${mdInline(um[1])}</p>`)
    } else if (hr) {
      parts.push('<hr style="border:none;border-top:1px solid #1E2D3D;margin:10px 0;"/>')
    } else {
      parts.push(`<p style="${P}">${mdInline(line)}</p>`)
    }
  }

  return parts.join('')
}
