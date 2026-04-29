import type { Match, Registration } from '../../types/index'

// Subscribe template IDs — fill after creating in WeChat MP backend
const SUBSCRIBE_TEMPLATES = {
  promoted: 'REPLACE_PROMOTED_TEMPLATE_ID',
  draftReady: 'REPLACE_DRAFT_READY_TEMPLATE_ID',
}

Page({
  data: {
    matchId: '' as string,
    match: null as Match | null,
    registrations: [] as Registration[],
    myReg: null as Registration | null,
    loading: true,
    isAdmin: false,
  },

  onLoad(options: Record<string, string>) {
    const matchId = options.id || ''
    this.setData({ matchId })
    this.loadMatch()
  },

  onShow() {
    if (this.data.matchId) this.loadMatch()
  },

  async loadMatch() {
    if (!this.data.matchId) return
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      const app = getApp<{ globalData: { userProfile: { _id: string; role: string } | null } }>()
      const user = app.globalData.userProfile

      const [matchDoc, regsRes] = await Promise.all([
        db.collection('matches').doc(this.data.matchId).get(),
        db.collection('matches').doc(this.data.matchId)
          .collection('registrations').orderBy('registeredAt', 'asc').get(),
      ])

      const registrations = regsRes.data as unknown as Registration[]
      const myReg = user ? registrations.find(r => r.uid === user._id) ?? null : null

      this.setData({
        match: matchDoc.data as unknown as Match,
        registrations,
        myReg,
        isAdmin: user?.role === 'admin',
      })
    } catch (err) {
      console.error('loadMatch failed', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  async register() {
    // Request subscribe permissions before registering
    try {
      await wx.requestSubscribeMessage({
        tmplIds: [SUBSCRIBE_TEMPLATES.promoted, SUBSCRIBE_TEMPLATES.draftReady],
      })
    } catch (_) {
      // User denied or dismissed — still allow registration
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'registerForMatch',
        data: { matchId: this.data.matchId },
      }) as { result: { status: string } }
      const status = res.result.status
      wx.showToast({
        title: status === 'waitlist' ? '已加入候补' : '报名成功',
        icon: 'success',
      })
      this.loadMatch()
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '报名失败', icon: 'error' })
    }
  },

  async withdraw() {
    const confirm = await wx.showModal({ title: '确认退出报名？', content: '' })
    if (!confirm.confirm) return
    try {
      await wx.cloud.callFunction({
        name: 'withdrawFromMatch',
        data: { matchId: this.data.matchId },
      })
      wx.showToast({ title: '已退出', icon: 'success' })
      this.loadMatch()
    } catch (err) {
      console.error(err)
      wx.showToast({ title: '操作失败', icon: 'error' })
    }
  },

  onShareAppMessage() {
    return {
      title: this.data.match ? `${this.data.match.location} - 一起踢球` : '九州比赛',
      path: `/pages/match-detail/index?id=${this.data.matchId}`,
    }
  },
})
