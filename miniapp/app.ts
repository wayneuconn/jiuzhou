import type { User } from './types/index'

interface JiuzhouAppOption {
  globalData: {
    userProfile: User | null
    openid: string | null
  }
  refreshUserProfile: () => Promise<User | null>
}

App<JiuzhouAppOption>({
  globalData: {
    userProfile: null,
    openid: null,
  },

  async onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'cloudbase-d5gycaytc310dac20',
      traceUser: true,
    })
    await this.autoLogin()
  },

  async autoLogin() {
    try {
      const { code } = await wx.login()
      const res = await wx.cloud.callFunction({
        name: 'loginWithCode',
        data: { code },
      })
      const result = res.result as { openid: string; user: User | null }
      this.globalData.openid = result.openid
      this.globalData.userProfile = result.user

      if (!result.user?.phone) {
        wx.redirectTo({ url: '/pages/onboard/phone/index' })
      } else if (!result.user?.displayName) {
        wx.redirectTo({ url: '/pages/onboard/profile/index' })
      }
      // If user is complete, stay on home (first page in app.json)
    } catch (err) {
      console.error('autoLogin failed', err)
      wx.redirectTo({ url: '/pages/login/index' })
    }
  },

  async refreshUserProfile() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getCurrentUser' })
      const user = (res.result as { user: User | null } | undefined)?.user ?? null
      this.globalData.userProfile = user
      return user
    } catch (err) {
      console.error('refreshUserProfile failed', err)
      return null
    }
  },
})
