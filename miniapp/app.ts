import type { User, MembershipApplication, SeasonDrive, SeasonRenewal } from './types/index'

// The waiver as the player sees it: the text plus whether they're clear
export interface SeasonWaiverVM {
  season: string
  title: string
  body: string
  version: number
  required: boolean
  signed: boolean
}

interface CardThresholds { bronze: number; silver: number; gold: number; blue: number }

interface JiuzhouAppOption {
  globalData: {
    userProfile: User | null
    openid: string | null
    cardThresholds: CardThresholds | null
    pendingRoute: string | null
    myApplication: MembershipApplication | null
    pendingApplications: number
    seasonDrive: Pick<SeasonDrive, 'season' | 'deadline' | 'note' | 'questions'> | null
    myRenewal: Pick<SeasonRenewal, 'season' | 'response' | 'status' | 'birthday' | 'answers'> | null
    seasonWaiver: SeasonWaiverVM | null
  }
  loginReady: Promise<void>
  autoLogin: () => Promise<void>
  refreshUserProfile: () => Promise<User | null>
  redeemPendingInvite: () => Promise<string | null>
}

// An invite arrives as a launch param but can't be spent until the person has
// a profile, which may be several screens later — so it's parked in storage.
const INVITE_KEY = 'pendingInvite'

App<JiuzhouAppOption>({
  globalData: {
    userProfile: null,
    openid: null,
    cardThresholds: null,
    pendingRoute: null,
    myApplication: null,
    pendingApplications: 0,
    seasonDrive: null,
    myRenewal: null,
    seasonWaiver: null,
  },

  // Resolves once autoLogin has finished (success or failure). Pages must
  // await this before reading globalData.userProfile — on cold start the
  // page's onLoad/onShow fires before the login round-trip completes.
  loginReady: Promise.resolve(),

  onLaunch(options?: WechatMiniprogram.App.LaunchShowOption) {
    const code = (options?.query as { invite?: string } | undefined)?.invite
    if (code) {
      try { wx.setStorageSync(INVITE_KEY, code) } catch (_) {}
    }
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

  // Spend a parked invite code. Safe to call repeatedly: the cloud side is
  // idempotent per person and reports back which case applied.
  async redeemPendingInvite(): Promise<string | null> {
    let code = ''
    try { code = wx.getStorageSync(INVITE_KEY) || '' } catch (_) { return null }
    if (!code) return null
    try {
      const res = await wx.cloud.callFunction({ name: 'redeemInvite', data: { code } })
      const status = (res.result as { status: string } | undefined)?.status ?? ''
      // Keep it parked only while it still might work (no profile yet)
      if (status !== 'needProfile') {
        try { wx.removeStorageSync(INVITE_KEY) } catch (_) {}
      }
      if (status === 'granted') await this.refreshUserProfile()
      return status
    } catch (err) {
      console.error('redeemInvite failed', err)
      return null
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
        seasonDrive: Pick<SeasonDrive, 'season' | 'deadline' | 'note' | 'questions'> | null
        myRenewal: Pick<SeasonRenewal, 'season' | 'response' | 'status' | 'birthday' | 'answers'> | null
        seasonWaiver: SeasonWaiverVM | null
      } | undefined
      const user = result?.user ?? null
      this.globalData.userProfile = user
      if (result?.cardThresholds) this.globalData.cardThresholds = result.cardThresholds
      this.globalData.myApplication = result?.myApplication ?? null
      this.globalData.pendingApplications = result?.pendingApplications ?? 0
      this.globalData.seasonDrive = result?.seasonDrive ?? null
      this.globalData.myRenewal = result?.myRenewal ?? null
      this.globalData.seasonWaiver = result?.seasonWaiver ?? null
      return user
    } catch (err) {
      console.error('refreshUserProfile failed', err)
      return null
    }
  },
})
