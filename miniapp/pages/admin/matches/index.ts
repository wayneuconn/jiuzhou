import type { Match } from '../../../types/index'

Page({
  data: {
    matches: [] as Match[],
    loading: true,
  },

  onShow() {
    this.loadMatches()
  },

  async loadMatches() {
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      const res = await db.collection('matches').orderBy('date', 'desc').limit(50).get()
      this.setData({ matches: res.data as unknown as Match[] })
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  async createMatch() {
    await wx.cloud.callFunction({ name: 'createMatch', data: {} })
    wx.showToast({ title: '已创建', icon: 'success' })
    this.loadMatches()
  },

  goDetail(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/match-detail/index?id=${id}&admin=1` })
  },

  async updateStatus(e: WechatMiniprogram.BaseEvent) {
    const { id, status } = e.currentTarget.dataset as { id: string; status: string }
    await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status } })
    this.loadMatches()
  },
})
