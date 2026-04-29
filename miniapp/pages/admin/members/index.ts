import type { User } from '../../../types/index'

Page({
  data: {
    members: [] as User[],
    loading: true,
  },

  onShow() {
    this.loadMembers()
  },

  async loadMembers() {
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      const res = await db.collection('users').orderBy('displayName', 'asc').limit(100).get()
      this.setData({ members: res.data as unknown as User[] })
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  goMember(e: WechatMiniprogram.BaseEvent) {
    const uid = (e.currentTarget.dataset as { uid: string }).uid
    wx.navigateTo({ url: `/pages/admin/members/detail?uid=${uid}` })
  },
})
