// Membership contact. Deliberately NO amounts or payment wording anywhere in
// the UI — personal-entity mini programs get rejected for that (审核 3.2).
// The admin communicates any details privately.
export const ADMIN_CONTACT = { name: '文木木', wechat: 'liboefz' }

export function copyAdminWechat() {
  wx.setClipboardData({
    data: ADMIN_CONTACT.wechat,
    success: () => wx.showToast({ title: '微信号已复制', icon: 'success' }),
    fail: () => wx.showToast({ title: '复制失败', icon: 'none' }),
  })
}
