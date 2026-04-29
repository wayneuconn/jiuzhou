import type { Match } from '../../types/index'
import { formatDateShort, STATUS_LABEL, STATUS_BADGE } from '../../utils/format'

interface MatchVM extends Match {
  dateStr: string
  statusLabel: string
  statusBadge: string
}

Page({
  data: {
    matches: [] as MatchVM[],
    loading: true,
  },

  onShow() {
    this.loadMatches()
  },

  onPullDownRefresh() {
    this.loadMatches().finally(() => wx.stopPullDownRefresh())
  },

  async loadMatches() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getMatches' }) as { result: { matches: Match[] } }
      const matches: MatchVM[] = res.result.matches.map(m => ({
        ...m,
        dateStr: formatDateShort(m.date),
        statusLabel: STATUS_LABEL[m.status] ?? m.status,
        statusBadge: STATUS_BADGE[m.status] ?? 'badge-grey',
      }))
      this.setData({ matches })
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
