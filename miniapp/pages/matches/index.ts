import type { Match } from '../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE } from '../../utils/format'

const STATUS_NEXT: Record<string, string> = {
  draft: 'registration_r1',
  registration_r1: 'registration_r2',
  registration_r2: 'drafting',
  drafting: 'ready',
  ready: 'completed',
}

interface MatchVM extends Match {
  dateStr: string
  statusLabel: string
  statusBadge: string
  statusDot: string
  isOpen: boolean
  nextStatus: string
  nextStatusLabel: string
  canAdvance: boolean
}

Page({
  data: {
    upcoming: [] as MatchVM[],
    past: [] as MatchVM[],
    loading: true,
    isAdmin: false,
  },

  onShow() { this.loadMatches() },
  onPullDownRefresh() { this.loadMatches().finally(() => wx.stopPullDownRefresh()) },

  async loadMatches() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getMatches' }) as unknown as {
        result: { matches: Match[]; isAdmin: boolean }
      }
      const isAdmin = res.result.isAdmin ?? false
      const all: MatchVM[] = res.result.matches.map(m => ({
        ...m,
        dateStr: formatDate(m.date),
        statusLabel: STATUS_LABEL[m.status] ?? m.status,
        statusBadge: STATUS_BADGE[m.status] ?? 'badge-grey',
        statusDot: m.status === 'drafting' ? 'dot-pulse'
          : ['registration_r1', 'registration_r2', 'ready'].includes(m.status) ? 'dot-teal'
          : m.status === 'cancelled' ? 'dot-red'
          : 'dot-grey',
        isOpen: m.status === 'registration_r1' || m.status === 'registration_r2',
        nextStatus: STATUS_NEXT[m.status] ?? '',
        nextStatusLabel: STATUS_LABEL[STATUS_NEXT[m.status]] ?? '',
        canAdvance: !!STATUS_NEXT[m.status],
      }))
      // admins see draft matches too
      const upcoming = all.filter(m =>
        m.status !== 'completed' && m.status !== 'cancelled' && (isAdmin || m.status !== 'draft')
      )
      const past = all.filter(m => m.status === 'completed')
      this.setData({ upcoming, past, isAdmin })
    } catch (err) {
      console.error('loadMatches failed', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  goToDetail(e: WechatMiniprogram.BaseEvent) {
    const matchId = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/match-detail/index?id=${matchId}` })
  },

  async advanceStatus(e: WechatMiniprogram.BaseEvent) {
    const { id, next } = e.currentTarget.dataset as { id: string; next: string }
    const label = STATUS_LABEL[next] ?? next
    const res = await wx.showModal({ title: `确认改为「${label}」？`, content: '', confirmColor: '#00C9A7' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: next } })
      this.loadMatches()
    } catch { wx.showToast({ title: '操作失败', icon: 'error' }) }
  },

  async cancelMatch(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const res = await wx.showModal({ title: '确认取消比赛？', content: '此操作不可撤销', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: 'cancelled' } })
      this.loadMatches()
    } catch { wx.showToast({ title: '操作失败', icon: 'error' }) }
  },

  onShareAppMessage() {
    return { title: '九州比赛安排', path: '/pages/matches/index' }
  },
})
