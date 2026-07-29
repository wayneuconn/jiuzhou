import type { AppConfig } from '../../../types/index'
import { DEFAULT_THRESHOLDS } from '../../../utils/format'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

Page({
  data: {
    config: null as AppConfig | null,
    loading: true,
    loadError: false,
    saving: false,
    weekdays: WEEKDAYS,
    recurringDaysMap: {} as Record<number, boolean>,
  },

  onShow() {
    this.loadConfig()
  },

  async loadConfig() {
    this.setData({ loading: true, loadError: false })
    try {
      const res = await wx.cloud.callFunction({ name: 'adminGetConfig' }) as unknown as { result: { config: Partial<AppConfig> | null } }
      const raw: Partial<AppConfig> = res.result.config ?? {}
      const config: AppConfig = {
        season: '',
        cardThresholds: DEFAULT_THRESHOLDS,
        waitlistConfirmMinutes: 30,
        defaultAgreementText: '',
        defaultAnnouncement: '',
        perSessionFee: 0,
        autoRecurring: false,
        recurringDays: [],
        recurringHour: 20,
        recurringMinute: 0,
        recurringLocation: '',
        winterBreakStart: '',
        winterBreakEnd: '',
        ...raw,
      }
      const recurringDaysMap: Record<number, boolean> = {}
      config.recurringDays.forEach(d => { recurringDaysMap[d] = true })
      this.setData({ config, recurringDaysMap })
    } catch (err) {
      console.error(err)
      this.setData({ loadError: true })
    } finally {
      this.setData({ loading: false })
    }
  },

  retryLoad() { this.loadConfig() },

  onInput(e: WechatMiniprogram.Input) {
    const field = (e.currentTarget.dataset as { field: string }).field
    const numericFields = ['waitlistConfirmMinutes', 'perSessionFee', 'recurringHour', 'recurringMinute']
    const value = numericFields.includes(field) ? parseFloat(e.detail.value) || 0 : e.detail.value
    this.setData({ [`config.${field}`]: value })
  },

  onSwitch(e: WechatMiniprogram.SwitchChange) {
    const field = (e.currentTarget.dataset as { field: string }).field
    this.setData({ [`config.${field}`]: e.detail.value })
  },

  toggleDay(e: WechatMiniprogram.BaseEvent) {
    const day = Number((e.currentTarget.dataset as { day: string }).day)
    const days = [...(this.data.config?.recurringDays ?? [])]
    const idx = days.indexOf(day)
    if (idx >= 0) days.splice(idx, 1)
    else { days.push(day); days.sort((a, b) => a - b) }
    const recurringDaysMap: Record<number, boolean> = {}
    days.forEach(d => { recurringDaysMap[d] = true })
    this.setData({ 'config.recurringDays': days, recurringDaysMap })
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
