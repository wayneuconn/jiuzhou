import type { Match, User, Registration } from '../../../types/index'
import { formatDate, STATUS_LABEL } from '../../../utils/format'
import { bankAdminSubscribe } from '../../../utils/subscribe'

interface MatchBoard {
  matchId: string
  dateStr: string
  statusLabel: string
  confirmed: number
  maxPlayers: number
  waitlist: number
  excused: number
}

Page({
  data: {
    memberCount: 0,
    activeMatchCount: 0,
    pendingApplications: 0,
    board: null as MatchBoard | null,
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
      const [matchRes, memberRes, meRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'getMatches' }) as unknown as Promise<{ result: { matches: Match[] } }>,
        wx.cloud.callFunction({ name: 'adminGetMembers' }) as unknown as Promise<{ result: { members: User[] } }>,
        wx.cloud.callFunction({ name: 'getCurrentUser' }) as unknown as Promise<{ result: { pendingApplications?: number } }>,
      ])
      const activeMatches = matchRes.result.matches
        .filter((m: Match) => !['completed', 'cancelled', 'draft'].includes(m.status))
        .sort((a: Match, b: Match) => a.date - b.date)
      this.setData({
        activeMatchCount: activeMatches.length,
        memberCount: memberRes.result.members.length,
        pendingApplications: meRes.result.pendingApplications ?? 0,
      })
      // Live board for the next match — replaces per-signup push notifications
      if (activeMatches[0]) this.loadBoard(activeMatches[0])
      else this.setData({ board: null })
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  async loadBoard(match: Match) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getMatchDetail',
        data: { matchId: match.id },
      }) as unknown as { result: { registrations: Registration[] } }
      const regs = res.result.registrations
      this.setData({
        board: {
          matchId: match.id,
          dateStr: formatDate(match.date),
          statusLabel: STATUS_LABEL[match.status] ?? match.status,
          confirmed: regs.filter(r => r.status === 'confirmed' || r.status === 'promoted').length,
          maxPlayers: match.maxPlayers,
          waitlist: regs.filter(r => r.status === 'waitlist').length,
          excused: regs.filter(r => r.status === 'excused').length,
        },
      })
    } catch (err) { console.error('loadBoard failed', err) }
  },

  goBoard() {
    if (this.data.board) wx.navigateTo({ url: `/pages/match-detail/index?id=${this.data.board.matchId}` })
  },

  go(e: WechatMiniprogram.BaseEvent) {
    // Every menu tap quietly banks one subscribe-message authorization
    bankAdminSubscribe()
    const url = (e.currentTarget.dataset as { url: string }).url
    wx.navigateTo({ url })
  },
})
