// One-time subscribe-message quota banking for admins.
//
// Admin notifications (请假/退出、满员、会员申请) each consume one banked
// authorization. wx.requestSubscribeMessage must run inside a tap handler,
// so admin pages call this at the top of their common tap actions — after
// the admin checks 「总是保持以上选择」 once, every call banks +1 silently.
//
// Fill in real template IDs (from mp.weixin.qq.com → 订阅消息) to activate;
// placeholders make this a no-op.
const ADMIN_TEMPLATES = [
  'REPLACE_ADMIN_ALERT_ID',      // 管理员事件提醒 (请假/退出/满员)
  'REPLACE_MEMBERSHIP_APPLIED_ID', // 会员申请提醒
]

export function bankAdminSubscribe() {
  const tmplIds = ADMIN_TEMPLATES.filter(t => !t.startsWith('REPLACE_')).slice(0, 3)
  if (tmplIds.length === 0) return
  try {
    wx.requestSubscribeMessage({ tmplIds, complete: () => {} })
  } catch (_) { /* older base libs */ }
}
