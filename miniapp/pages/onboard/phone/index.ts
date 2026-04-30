// Phone binding is optional and not part of the main onboard flow.
// This page is kept for future use but immediately redirects to profile setup.
Page({
  onLoad() {
    wx.redirectTo({ url: '/pages/onboard/profile/index' })
  },
})
