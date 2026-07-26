import type { Match, User } from '../../../types/index'

Page({
  data: {
    memberCount: 0,
    activeMatchCount: 0,
    loading: true,
  },

  async onLoad() {
    const app = getApp<{
      globalData: { userProfile: { role: string } | null }
      loginReady?: Promise<void>
    }>()
    // Cold start (deep link / session restore): wait for autoLogin before the
    // admin gate, or a real admin gets bounced with 无权限.
    await (app.loginReady ?? Promise.resolve()).catch(() => {})
    if (app.globalData.userProfile?.role !== 'admin') {
      wx.showToast({ title: '无权限', icon: 'error' })
      wx.navigateBack()
    }
  },

  onShow() { this.loadStats() },

  async loadStats() {
    this.setData({ loading: true })
    try {
      const [matchRes, memberRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'getMatches' }) as unknown as Promise<{ result: { matches: Match[] } }>,
        wx.cloud.callFunction({ name: 'adminGetMembers' }) as unknown as Promise<{ result: { members: User[] } }>,
      ])
      const active = matchRes.result.matches.filter((m: Match) =>
        !['completed', 'cancelled', 'draft'].includes(m.status)
      ).length
      this.setData({ activeMatchCount: active, memberCount: memberRes.result.members.length })
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  go(e: WechatMiniprogram.BaseEvent) {
    const url = (e.currentTarget.dataset as { url: string }).url
    wx.navigateTo({ url })
  },
})
