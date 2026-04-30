interface StatRow {
  uid: string
  displayName: string
  membershipType: string
  preferredPositions: string[]
  count: number
  lateCount: number
  dangerousCount: number
}

const today = () => new Date().toISOString().slice(0, 10)
const monthAgo = () => {
  const d = new Date()
  d.setMonth(d.getMonth() - 3)
  return d.toISOString().slice(0, 10)
}

Page({
  data: {
    fromDate: monthAgo(),
    toDate: today(),
    stats: [] as StatRow[],
    matchCount: 0,
    loading: false,
    searched: false,
  },

  onLoad() {
    const app = getApp<{ globalData: { userProfile: { role: string } | null } }>()
    if (app.globalData.userProfile?.role !== 'admin') {
      wx.showToast({ title: '无权限', icon: 'error' })
      wx.navigateBack()
    }
  },

  onFromChange(e: WechatMiniprogram.BaseEvent & { detail: { value: string } }) {
    this.setData({ fromDate: e.detail.value })
  },

  onToChange(e: WechatMiniprogram.BaseEvent & { detail: { value: string } }) {
    this.setData({ toDate: e.detail.value })
  },

  async query() {
    const { fromDate, toDate } = this.data
    if (!fromDate || !toDate) return
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAttendanceStats',
        data: {
          fromDate: new Date(fromDate).getTime(),
          toDate: new Date(toDate + 'T23:59:59').getTime(),
        },
      }) as unknown as { result: { stats: StatRow[]; matchCount: number } }
      this.setData({ stats: res.result.stats, matchCount: res.result.matchCount, searched: true })
    } catch (err: unknown) {
      wx.showToast({ title: (err as Error).message || '查询失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
})
