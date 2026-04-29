import type { User } from '../../types/index'

const app = getApp<{ globalData: { userProfile: User | null; openid: string | null } }>()

Page({
  data: {
    loading: false,
  },

  async onLogin() {
    this.setData({ loading: true })
    try {
      const { code } = await wx.login()
      const res = await wx.cloud.callFunction({
        name: 'loginWithCode',
        data: { code },
      })
      const result = res.result as { openid: string; user: User | null }
      app.globalData.openid = result.openid
      app.globalData.userProfile = result.user

      if (!result.user) {
        wx.redirectTo({ url: '/pages/onboard/phone/index' })
      } else if (!result.user.displayName) {
        wx.redirectTo({ url: '/pages/onboard/profile/index' })
      } else {
        wx.switchTab({ url: '/pages/home/index' })
      }
    } catch (err) {
      console.error('login failed', err)
      wx.showToast({ title: '登录失败', icon: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
