import type { User } from '../../types/index'

const app = getApp<{ globalData: { userProfile: User | null }; refreshUserProfile: () => Promise<User | null> }>()

Page({
  data: {
    user: null as User | null,
    loading: true,
  },

  async onShow() {
    this.setData({ loading: true })
    const user = await app.refreshUserProfile()
    this.setData({ user, loading: false })
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/dashboard/index' })
  },

  async logout() {
    const res = await wx.showModal({ title: '确认退出？', content: '' })
    if (!res.confirm) return
    wx.removeStorageSync('jz_user')
    wx.reLaunch({ url: '/pages/login/index' })
  },
})
