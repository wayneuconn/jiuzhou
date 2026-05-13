import type { Match, Announcement } from '../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE, markdownToHtml } from '../../utils/format'

type NextMatchVM = Match & { dateStr: string; statusLabel: string; statusBadge: string }
type AnnVM = Announcement & { contentHtml: string }

Page({
  data: {
    announcements: [] as AnnVM[],
    nextMatch: null as NextMatchVM | null,
    season: '',
    loading: true,
  },

  onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    this.loadData()
  },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()) },

  async loadData() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getAnnouncements' }) as unknown as {
        result: { announcements: Announcement[]; nextMatch: Match | null; season: string }
      }
      const { announcements, nextMatch, season } = res.result
      this.setData({
        announcements: announcements.map(a => ({ ...a, contentHtml: markdownToHtml(a.content) })),
        season,
        nextMatch: nextMatch ? {
          ...nextMatch,
          dateStr: formatDate(nextMatch.date),
          statusLabel: STATUS_LABEL[nextMatch.status] ?? nextMatch.status,
          statusBadge: STATUS_BADGE[nextMatch.status] ?? 'badge-grey',
        } : null,
      })
    } catch (err) {
      console.error('loadData failed', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  goToMatch() {
    if (this.data.nextMatch) {
      wx.navigateTo({ url: `/pages/match-detail/index?id=${this.data.nextMatch.id}` })
    }
  },

  onShareAppMessage() {
    return { title: '九州球队 - 一起踢球吧', path: '/pages/home/index' }
  },
})
