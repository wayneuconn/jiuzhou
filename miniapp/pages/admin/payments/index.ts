import type { Payment } from '../../../types/index'

Page({
  data: {
    pending: [] as (Payment & { id: string })[],
    confirmed: [] as (Payment & { id: string })[],
    loading: true,
  },

  onShow() { this.loadData() },

  async loadData() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'adminGetPayments' }) as unknown as {
        result: { payments: (Payment & { id: string })[] }
      }
      const payments = res.result.payments
      this.setData({
        pending: payments.filter(p => p.status === 'pending'),
        confirmed: payments.filter(p => p.status === 'confirmed'),
      })
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  async confirm(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    try {
      await wx.cloud.callFunction({ name: 'confirmPayment', data: { paymentId: id } })
      wx.showToast({ title: '已确认', icon: 'success' })
      this.loadData()
    } catch { wx.showToast({ title: '操作失败', icon: 'error' }) }
  },
})
