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
      // No forced onboarding (WeChat review rule: visitors must be able to
      // browse before any profile/login step). Profile setup is prompted at
      // action points instead — 报名 / 申请会员 / 我的 tab.
    } catch (err) {
      console.error('autoLogin failed', err)
    }
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
