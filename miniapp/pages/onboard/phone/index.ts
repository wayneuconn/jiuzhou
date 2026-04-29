Page({
  data: {
    loading: false,
  },

  skipForNow() {
    wx.redirectTo({ url: '/pages/onboard/profile/index' })
  },

  async onGetPhone(e: WechatMiniprogram.ButtonGetPhoneNumber) {
    if (!e.detail.code) {
      wx.showToast({ title: '请授权手机号', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      await wx.cloud.callFunction({
        name: 'bindPhone',
        data: { code: e.detail.code },
      })
      wx.redirectTo({ url: '/pages/onboard/profile/index' })
    } catch (err) {
      console.error('bindPhone failed', err)
      wx.showToast({ title: '绑定失败', icon: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
