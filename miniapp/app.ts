import type { User } from './types/index'

interface CardThresholds { bronze: number; silver: number; gold: number; blue: number }

interface JiuzhouAppOption {
  globalData: {
    userProfile: User | null
    openid: string | null
    cardThresholds: CardThresholds | null
    pendingRoute: string | null
  }
  loginReady: Promise<void>
  autoLogin: () => Promise<void>
  refreshUserProfile: () => Promise<User | null>
}

App<JiuzhouAppOption>({
  globalData: {
    userProfile: null,
    openid: null,
    cardThresholds: null,
    pendingRoute: null,
  },

  // Resolves once autoLogin has finished (success or failure). Pages must
  // await this before reading globalData.userProfile — on cold start the
  // page's onLoad/onShow fires before the login round-trip completes.
  loginReady: Promise.resolve(),

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'cloudbase-d5gycaytc310dac20',
      traceUser: true,
    })
    this.loginReady = this.autoLogin()
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

      if (!result.user?.displayName) {
        // Remember where the user was heading (e.g. a shared match link) so
        // onboarding can send them back instead of dropping them on home.
        setTimeout(() => {
          const pages = getCurrentPages()
          const cur = pages[pages.length - 1]
          if (cur && cur.route !== 'pages/onboard/profile/index') {
            const qs = Object.entries(cur.options || {})
              .map(([k, v]) => `${k}=${v}`)
              .join('&')
            this.globalData.pendingRoute = `/${cur.route}${qs ? '?' + qs : ''}`
          }
          wx.redirectTo({ url: '/pages/onboard/profile/index' })
        }, 0)
      }
      // If user has a displayName they're good; phone binding is optional
    } catch (err) {
      console.error('autoLogin failed', err)
      setTimeout(() => wx.redirectTo({ url: '/pages/login/index' }), 0)
    }
  },

  async refreshUserProfile() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getCurrentUser' })
      const result = res.result as { user: User | null; cardThresholds: CardThresholds | null } | undefined
      const user = result?.user ?? null
      this.globalData.userProfile = user
      if (result?.cardThresholds) this.globalData.cardThresholds = result.cardThresholds
      return user
    } catch (err) {
      console.error('refreshUserProfile failed', err)
      return null
    }
  },
})
