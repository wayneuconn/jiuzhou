import type { Match } from '../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE } from '../../utils/format'

interface MatchVM extends Match {
  dateStr: string
  statusLabel: string
  statusBadge: string
  statusDot: string
  isOpen: boolean
}

Page({
  data: {
    upcoming: [] as MatchVM[],
    past: [] as MatchVM[],
    loading: true,
  },

  onShow() { this.loadMatches() },
  onPullDownRefresh() { this.loadMatches().finally(() => wx.stopPullDownRefresh()) },

  async loadMatches() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getMatches' }) as { result: { matches: Match[] } }
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
      }))
      const upcoming = all.filter(m => m.status !== 'completed' && m.status !== 'draft' && m.status !== 'cancelled')
      const past = all.filter(m => m.status === 'completed')
      this.setData({ upcoming, past })
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

  onShareAppMessage() {
    return { title: '九州比赛安排', path: '/pages/matches/index' }
  },
})
