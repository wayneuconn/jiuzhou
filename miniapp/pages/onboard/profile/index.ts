const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST']

Page({
  data: {
    displayName: '',
    selectedMap: {} as Record<string, boolean>,
    POSITIONS,
    loading: false,
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ displayName: e.detail.value })
  },

  togglePosition(e: WechatMiniprogram.BaseEvent) {
    const pos = (e.currentTarget.dataset as { pos: string }).pos
    const key = `selectedMap.${pos}`
    this.setData({ [key]: !this.data.selectedMap[pos] })
  },

  async onSubmit() {
    if (!this.data.displayName.trim()) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const preferredPositions = POSITIONS.filter(p => this.data.selectedMap[p])
      await wx.cloud.callFunction({
        name: 'updateProfile',
        data: {
          displayName: this.data.displayName.trim(),
          preferredPositions,
        },
      })
      const app = getApp<{
        globalData: { pendingRoute: string | null }
        refreshUserProfile: () => Promise<unknown>
      }>()
      await app.refreshUserProfile()
      // If onboarding interrupted a deep link (e.g. a shared match), resume it.
      const pending = app.globalData.pendingRoute
      if (pending) {
        app.globalData.pendingRoute = null
        wx.redirectTo({ url: pending, fail: () => wx.switchTab({ url: '/pages/home/index' }) })
      } else {
        wx.switchTab({ url: '/pages/home/index' })
      }
    } catch (err) {
      console.error('updateProfile failed', err)
      wx.showToast({ title: '保存失败', icon: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
