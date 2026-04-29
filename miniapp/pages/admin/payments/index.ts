import type { Payment, PaymentEvent } from '../../../types/index'

Page({
  data: {
    events: [] as PaymentEvent[],
    payments: [] as Payment[],
    loading: true,
  },

  onShow() {
    this.loadData()
  },

  async loadData() {
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      const [eventsRes, paymentsRes] = await Promise.all([
        db.collection('paymentEvents').orderBy('createdAt', 'desc').limit(10).get(),
        db.collection('payments').orderBy('paidAt', 'desc').limit(100).get(),
      ])
      this.setData({
        events: eventsRes.data as unknown as PaymentEvent[],
        payments: paymentsRes.data as unknown as Payment[],
      })
    } catch (err) {
      console.error(err)
    } finally {
      this.setData({ loading: false })
    }
  },

  async confirmPayment(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    await wx.cloud.callFunction({ name: 'confirmPayment', data: { paymentId: id } })
    wx.showToast({ title: '已确认', icon: 'success' })
    this.loadData()
  },
})
