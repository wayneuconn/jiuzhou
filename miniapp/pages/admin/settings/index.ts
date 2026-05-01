import type { AppConfig } from '../../../types/index'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

Page({
  data: {
    config: null as AppConfig | null,
    loading: true,
    saving: false,
    weekdays: WEEKDAYS,
  },

  onShow() {
    this.loadConfig()
  },

  async loadConfig() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'adminGetConfig' }) as unknown as { result: { config: AppConfig } }
      const config: AppConfig = {
        season: '',
        cardThresholds: { bronze: 5, silver: 15, gold: 30, blue: 50 },
        waitlistConfirmMinutes: 30,
        defaultAgreementText: '',
        defaultAnnouncement: '',
        perSessionFee: 0,
        autoRecurring: false,
        recurringDayOfWeek: 0,
        recurringHour: 20,
        recurringMinute: 0,
        recurringLocation: '',
        recurringMaxPlayers: 22,
        winterBreakStart: '',
        winterBreakEnd: '',
        ...res.result.config,
      }
      this.setData({ config })
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  onInput(e: WechatMiniprogram.Input) {
    const field = (e.currentTarget.dataset as { field: string }).field
    const numericFields = ['waitlistConfirmMinutes', 'perSessionFee', 'recurringHour', 'recurringMinute', 'recurringMaxPlayers']
    const value = numericFields.includes(field) ? parseFloat(e.detail.value) || 0 : e.detail.value
    this.setData({ [`config.${field}`]: value })
  },

  onSwitch(e: WechatMiniprogram.SwitchChange) {
    const field = (e.currentTarget.dataset as { field: string }).field
    this.setData({ [`config.${field}`]: e.detail.value })
  },

  onDayPicker(e: WechatMiniprogram.PickerChange) {
    this.setData({ 'config.recurringDayOfWeek': Number(e.detail.value) })
  },

  onDatePicker(e: WechatMiniprogram.PickerChange) {
    const field = (e.currentTarget.dataset as { field: string }).field
    this.setData({ [`config.${field}`]: e.detail.value })
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
