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
      const db = wx.cloud.database()
      const res = await db.collection('announcements')
        .orderBy('pinned', 'desc')
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get()
      this.setData({ announcements: res.data as unknown as Announcement[] })
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
