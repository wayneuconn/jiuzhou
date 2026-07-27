import type { User, MembershipApplication } from './types/index'

interface CardThresholds { bronze: number; silver: number; gold: number; blue: number }

interface JiuzhouAppOption {
  globalData: {
    userProfile: User | null
    openid: string | null
    cardThresholds: CardThresholds | null
    pendingRoute: string | null
    myApplication: MembershipApplication | null
    pendingApplications: number
  }
  loginReady: Promise<void>
  autoLogin: () => Promise<void>
  refreshUserProfile: () => Promise<User | null>
  _redirectWithRetry: (url: string, capturePending: boolean, attempt?: number) => void
}

App<JiuzhouAppOption>({
  globalData: {
    userProfile: null,
    openid: null,
    cardThresholds: null,
    pendingRoute: null,
    myApplication: null,
    pendingApplications: 0,
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
        this._redirectWithRetry('/pages/onboard/profile/index', true)
      }
      // If user has a displayName they're good; phone binding is optional
    } catch (err) {
      console.error('autoLogin failed', err)
      this._redirectWithRetry('/pages/login/index', false)
    }
  },

  // At cold start the entry page may still be loading, in which case
  // wx.redirectTo fails silently — new users then strand on the shared match
  // page seeing 报名已关闭. Retry until the page stack is ready.
  _redirectWithRetry(url: string, capturePending: boolean, attempt = 0) {
    if (attempt >= 6) return
    setTimeout(() => {
      const pages = getCurrentPages()
      const cur = pages[pages.length - 1]
      if (!cur) { this._redirectWithRetry(url, capturePending, attempt + 1); return }
      if ('/' + cur.route === url) return
      if (capturePending && cur.route !== 'pages/onboard/profile/index') {
        const qs = Object.entries(cur.options || {})
          .map(([k, v]) => `${k}=${v}`)
          .join('&')
        this.globalData.pendingRoute = `/${cur.route}${qs ? '?' + qs : ''}`
      }
      wx.redirectTo({
        url,
        fail: () => this._redirectWithRetry(url, capturePending, attempt + 1),
      })
    }, attempt === 0 ? 0 : 400)
  },

  async refreshUserProfile() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getCurrentUser' })
      const result = res.result as {
        user: User | null
        cardThresholds: CardThresholds | null
        myApplication: MembershipApplication | null
        pendingApplications: number
      } | undefined
      const user = result?.user ?? null
      this.globalData.userProfile = user
      if (result?.cardThresholds) this.globalData.cardThresholds = result.cardThresholds
      this.globalData.myApplication = result?.myApplication ?? null
      this.globalData.pendingApplications = result?.pendingApplications ?? 0
      return user
    } catch (err) {
      console.error('refreshUserProfile failed', err)
      return null
    }
  },
})
