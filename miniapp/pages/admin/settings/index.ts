import type { AppConfig } from '../../../types/index'

Page({
  data: {
    config: null as AppConfig | null,
    loading: true,
    saving: false,
  },

  onShow() {
    this.loadConfig()
  },

  async loadConfig() {
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      const res = await db.collection('config').doc('app').get()
      this.setData({ config: res.data as unknown as AppConfig })
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    const field = (e.currentTarget.dataset as { field: string }).field
    this.setData({ [`config.${field}`]: e.detail.value })
  },

  async save() {
    if (!this.data.config) return
    this.setData({ saving: true })
    try {
      const db = wx.cloud.database()
      await db.collection('config').doc('app').set({ data: this.data.config })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '保存失败', icon: 'error' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
