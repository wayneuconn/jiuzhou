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

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'cloudbase-d5gycaytc310dac20',
      traceUser: true,
    })
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
