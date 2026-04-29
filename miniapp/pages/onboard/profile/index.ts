const POSITIONS = ['门将', '后卫', '中场', '前锋']

Page({
  data: {
    displayName: '',
    selectedPositions: [] as string[],
    POSITIONS,
    loading: false,
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ displayName: e.detail.value })
  },

  togglePosition(e: WechatMiniprogram.BaseEvent) {
    const pos = (e.currentTarget.dataset as { pos: string }).pos
    const set = new Set(this.data.selectedPositions)
    if (set.has(pos)) set.delete(pos)
    else set.add(pos)
    this.setData({ selectedPositions: Array.from(set) })
  },

  async onSubmit() {
    if (!this.data.displayName.trim()) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      await wx.cloud.callFunction({
        name: 'updateProfile',
        data: {
          displayName: this.data.displayName.trim(),
          preferredPositions: this.data.selectedPositions,
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
