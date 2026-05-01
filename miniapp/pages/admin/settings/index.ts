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
      const res = await wx.cloud.callFunction({ name: 'adminGetConfig' }) as unknown as { result: { config: AppConfig } }
      this.setData({ config: res.result.config })
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    const field = (e.currentTarget.dataset as { field: string }).field
    const numericFields = ['waitlistConfirmMinutes', 'perSessionFee']
    const value = numericFields.includes(field) ? parseFloat(e.detail.value) || 0 : e.detail.value
    this.setData({ [`config.${field}`]: value })
  },

  async save() {
    if (!this.data.config) return
    this.setData({ saving: true })
    try {
      await wx.cloud.callFunction({ name: 'adminSaveConfig', data: { config: this.data.config } })
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '保存失败', icon: 'error' })
    } finally {
      this.setData({ saving: false })
    }
  },
})
