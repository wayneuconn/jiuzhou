import type { User, Match } from '../../../types/index'

Page({
  data: {
    stats: { members: 0, activeMatches: 0 },
    loading: true,
  },

  onShow() {
    this.loadStats()
  },

  async loadStats() {
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const [members, activeMatches] = await Promise.all([
        db.collection('users').where({ role: _.neq('guest') }).count(),
        db.collection('matches').where({ status: _.in(['registration_r1', 'registration_r2', 'drafting', 'ready']) }).count(),
      ])
      this.setData({ stats: { members: members.total, activeMatches: activeMatches.total } })
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  go(e: WechatMiniprogram.BaseEvent) {
    const url = (e.currentTarget.dataset as { url: string }).url
    wx.navigateTo({ url })
  },
})
