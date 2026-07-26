interface StatRow {
  uid: string
  displayName: string
  membershipType: string
  preferredPositions: string[]
  count: number
  lateCount: number
  dangerousCount: number
}

// Local-timezone date strings (toISOString would shift the day near midnight)
const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => fmtDate(new Date())
const threeMonthsAgo = () => fmtDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))

Page({
  data: {
    fromDate: threeMonthsAgo(),
    toDate: today(),
    stats: [] as StatRow[],
    matchCount: 0,
    loading: false,
    searched: false,
  },

  async onLoad() {
    const app = getApp<{
      globalData: { userProfile: { role: string } | null }
      loginReady?: Promise<void>
    }>()
    // Wait for autoLogin before the admin gate (cold-start race).
    await (app.loginReady ?? Promise.resolve()).catch(() => {})
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
          // Both bounds in local time — bare new Date('YYYY-MM-DD') is UTC midnight
          fromDate: new Date(fromDate + 'T00:00:00').getTime(),
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
