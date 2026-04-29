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
      const db = wx.cloud.database()
      const res = await db.collection('matches')
        .orderBy('date', 'desc')
        .limit(50)
        .get()
      this.setData({ matches: res.data as unknown as Match[] })
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
