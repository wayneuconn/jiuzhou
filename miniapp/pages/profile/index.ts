import type { User, MembershipApplication } from '../../types/index'
import { getCardTier, getNextTierInfo, TIER_COLOR, DEFAULT_THRESHOLDS, TIER_LABEL } from '../../utils/format'

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']
const PRIORITY_LABELS = ['首选', '次选', '第三']
const MEMBERSHIP_LABEL: Record<string, string> = { annual: '年卡', per_session: '次卡', none: '未激活' }
const MEMBERSHIP_BADGE: Record<string, string> = { annual: 'badge-teal', per_session: 'badge-gold', none: 'badge-grey' }

interface PriorityPosition { pos: string; priorityLabel: string }

Page({
  data: {
    user: null as User | null,
    displayName: '',
    priorityPositions: [] as PriorityPosition[],
    availablePositions: [] as string[],
    selectedCount: 0,
    tier: 'none',
    tierColor: '#00C9A7',
    tierLabel: '',
    nextTierGamesLeft: 0,
    hasNextTier: false,
    membershipLabel: '',
    membershipBadge: '',
    loading: true,
    loadError: false,
    saving: false,
    saved: false,
    isAdmin: false,
    pendingApplications: 0,
    myAppStatus: '' as '' | 'pending' | 'rejected',
    myAppTypeLabel: '',
    myAppReason: '',
    showApplyModal: false,
    applyType: 'annual' as 'annual' | 'per_session',
    applyRealName: '',
    applyNote: '',
    applying: false,
  },

  _currentPositions: [] as string[],

  async onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    await this.loadProfile()
  },

  onShareAppMessage() {
    return { title: '九州足球俱乐部', path: '/pages/home/index' }
  },

  async loadProfile() {
    this.setData({ loading: true, loadError: false })
    try {
      const app = getApp<{
        globalData: {
          userProfile: User | null
          myApplication: MembershipApplication | null
          pendingApplications: number
        }
        refreshUserProfile: () => Promise<User | null>
      }>()
      const user = await app.refreshUserProfile()
      if (user) {
        this._applyUser(user)
        const myApp = app.globalData.myApplication
        const TYPE_LABEL: Record<string, string> = { annual: '年卡', per_session: '次卡' }
        this.setData({
          pendingApplications: app.globalData.pendingApplications,
          myAppStatus: myApp?.status === 'pending' ? 'pending' : myApp?.status === 'rejected' ? 'rejected' : '',
          myAppTypeLabel: myApp ? (TYPE_LABEL[myApp.requestedType] ?? '') : '',
          myAppReason: myApp?.rejectReason ?? '',
        })
      }
      // refreshUserProfile swallows network errors and returns null — treat
      // "no user and nothing cached" as a load failure, not a blank page.
      else if (!this.data.user) this.setData({ loadError: true })
    } catch (err) {
      console.error('loadProfile failed', err)
      if (!this.data.user) this.setData({ loadError: true })
    } finally {
      this.setData({ loading: false })
    }
  },

  retryLoad() { this.loadProfile() },

  _applyUser(user: User) {
    const app = getApp<{ globalData: { cardThresholds: typeof DEFAULT_THRESHOLDS | null } }>()
    const thresholds = app.globalData.cardThresholds ?? DEFAULT_THRESHOLDS
    const tier = getCardTier(user.attendanceCount, thresholds)
    const nextTier = getNextTierInfo(user.attendanceCount, thresholds)
    const priorityPositions: PriorityPosition[] = user.preferredPositions.map((pos, i) => ({
      pos,
      priorityLabel: PRIORITY_LABELS[i] ?? `${i + 1}`,
    }))
    const availablePositions = POSITIONS.filter(p => !user.preferredPositions.includes(p))
    this._currentPositions = [...user.preferredPositions]

    this.setData({
      user,
      displayName: user.displayName,
      priorityPositions,
      availablePositions,
      selectedCount: user.preferredPositions.length,
      tier,
      tierColor: TIER_COLOR[tier],
      tierLabel: TIER_LABEL[tier],
      hasNextTier: !!nextTier,
      nextTierGamesLeft: nextTier?.gamesLeft ?? 0,
      membershipLabel: MEMBERSHIP_LABEL[user.membershipType] ?? '未知',
      membershipBadge: MEMBERSHIP_BADGE[user.membershipType] ?? 'badge-grey',
      isAdmin: user.role === 'admin',
    })
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ displayName: e.detail.value })
  },

  removePosition(e: WechatMiniprogram.BaseEvent) {
    const pos = (e.currentTarget.dataset as { pos: string }).pos
    if (!this.data.user) return
    const newPositions = this._currentPositions.filter(p => p !== pos)
    this._currentPositions = newPositions
    this._applyUser({ ...this.data.user, preferredPositions: newPositions })
  },

  addPosition(e: WechatMiniprogram.BaseEvent) {
    const pos = (e.currentTarget.dataset as { pos: string }).pos
    if (!this.data.user) return
    if (this._currentPositions.length >= 3) return
    const newPositions = [...this._currentPositions, pos]
    this._currentPositions = newPositions
    this._applyUser({ ...this.data.user, preferredPositions: newPositions })
  },

  async saveProfile() {
    if (!this.data.displayName.trim()) {
      wx.showToast({ title: '请填写名字', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    try {
      await wx.cloud.callFunction({
        name: 'updateProfile',
        data: {
          displayName: this.data.displayName.trim(),
          preferredPositions: this._currentPositions,
        },
      })
      const trimmed = this.data.displayName.trim()
      this.setData({
        saved: true,
        'user.displayName': trimmed,
      })
      const app = getApp<{ globalData: { userProfile: User | null } }>()
      if (app.globalData.userProfile) {
        app.globalData.userProfile = {
          ...app.globalData.userProfile,
          displayName: trimmed,
          preferredPositions: this._currentPositions,
        }
      }
      setTimeout(() => this.setData({ saved: false }), 2000)
    } catch {
      wx.showToast({ title: '保存失败', icon: 'error' })
    } finally {
      this.setData({ saving: false })
    }
  },

  openApplyModal() {
    this.setData({
      showApplyModal: true,
      // Sensible default: non-annual members most often want annual
      applyType: this.data.user?.membershipType === 'annual' ? 'per_session' : 'annual',
      applyRealName: this.data.applyRealName || '',
      applyNote: '',
    })
  },
  closeApplyModal() { this.setData({ showApplyModal: false }) },
  noop() {},
  setApplyType(e: WechatMiniprogram.BaseEvent) {
    const type = (e.currentTarget.dataset as { type: 'annual' | 'per_session' }).type
    this.setData({ applyType: type })
  },
  onRealNameInput(e: WechatMiniprogram.Input) { this.setData({ applyRealName: e.detail.value }) },
  onNoteInput(e: WechatMiniprogram.Input) { this.setData({ applyNote: e.detail.value }) },

  async submitApplication() {
    if (!this.data.applyRealName.trim()) {
      wx.showToast({ title: '请填写真实姓名', icon: 'none' })
      return
    }
    this.setData({ applying: true })
    try {
      await wx.cloud.callFunction({
        name: 'applyMembership',
        data: {
          requestedType: this.data.applyType,
          realName: this.data.applyRealName.trim(),
          note: this.data.applyNote.trim(),
        },
      })
      wx.showToast({ title: '已提交，等待审批', icon: 'success' })
      this.setData({ showApplyModal: false })
      this.loadProfile()
    } catch (err: unknown) {
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message || '提交失败'
      wx.showModal({ title: '提交失败', content: msg, showCancel: false })
    } finally {
      this.setData({ applying: false })
    }
  },

  async cancelApplication() {
    const res = await wx.showModal({ title: '撤回申请？', content: '', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'applyMembership', data: { mode: 'cancel' } })
      wx.showToast({ title: '已撤回', icon: 'success' })
      this.loadProfile()
    } catch {
      wx.showToast({ title: '操作失败', icon: 'error' })
    }
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/dashboard/index' })
  },

  goAttendance() {
    wx.navigateTo({ url: '/pages/admin/attendance/index' })
  },

  async logout() {
    const res = await wx.showModal({ title: '确认退出？', content: '', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    const app = getApp<{ globalData: { userProfile: User | null; openid: string | null } }>()
    app.globalData.userProfile = null
    app.globalData.openid = null
    wx.reLaunch({ url: '/pages/login/index' })
  },
})
