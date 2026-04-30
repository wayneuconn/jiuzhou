import type { User } from '../../types/index'
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
    saving: false,
    saved: false,
    isAdmin: false,
  },

  _currentPositions: [] as string[],

  async onShow() {
    await this.loadProfile()
  },

  async loadProfile() {
    this.setData({ loading: true })
    try {
      const app = getApp<{
        globalData: { userProfile: User | null }
        refreshUserProfile: () => Promise<User | null>
      }>()
      const user = await app.refreshUserProfile()
      if (user) this._applyUser(user)
    } catch (err) {
      console.error('loadProfile failed', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  _applyUser(user: User) {
    const tier = getCardTier(user.attendanceCount, DEFAULT_THRESHOLDS)
    const nextTier = getNextTierInfo(user.attendanceCount, DEFAULT_THRESHOLDS)
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
      this.setData({ saved: true })
      const app = getApp<{ globalData: { userProfile: User | null } }>()
      if (app.globalData.userProfile) {
        app.globalData.userProfile = {
          ...app.globalData.userProfile,
          displayName: this.data.displayName.trim(),
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

  goBindPhone() {
    wx.navigateTo({ url: '/pages/onboard/phone/index' })
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
    wx.removeStorageSync('jz_user')
    wx.reLaunch({ url: '/pages/login/index' })
  },
})
