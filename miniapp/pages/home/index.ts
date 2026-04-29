import type { Announcement } from '../../types/index'

Page({
  data: {
    announcements: [] as Announcement[],
    loading: true,
  },

  onLoad() {
    this.loadAnnouncements()
  },

  onPullDownRefresh() {
    this.loadAnnouncements().finally(() => wx.stopPullDownRefresh())
  },

  async loadAnnouncements() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getAnnouncements' }) as { result: { announcements: Announcement[] } }
      this.setData({ announcements: res.result.announcements })
    } catch (err) {
      console.error('loadAnnouncements failed', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  onShareAppMessage() {
    return {
      title: '九州球队 - 一起踢球吧',
      path: '/pages/home/index',
    }
  },
})
