import type { Match } from '../../types/index'

Page({
  data: {
    matches: [] as Match[],
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
      this.setData({ matches: res.result.matches })
    } catch (err) {
      console.error('loadMatches failed', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  goToDetail(e: WechatMiniprogram.BaseEvent) {
    const matchId = e.currentTarget.dataset.id as string
    wx.navigateTo({ url: `/pages/match-detail/index?id=${matchId}` })
  },

  onShareAppMessage() {
    return {
      title: '九州比赛安排',
      path: '/pages/matches/index',
    }
  },
})
