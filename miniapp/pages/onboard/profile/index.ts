const POSITIONS = ['门将', '后卫', '中场', '前锋']

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
      wx.switchTab({ url: '/pages/home/index' })
    } catch (err) {
      console.error('updateProfile failed', err)
      wx.showToast({ title: '保存失败', icon: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
