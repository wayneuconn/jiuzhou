import type { Match, Announcement } from '../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE, markdownToHtml } from '../../utils/format'

type NextMatchVM = Match & { dateStr: string; statusLabel: string; statusBadge: string }
type AnnVM = Announcement & { contentHtml: string }

interface ActiveEventVM {
  id: string
  title: string
  statusLabel: string
}

const EGG_COLORS = ['#00C9A7', '#F0B429', '#EF4444', '#3B82F6', '#e8f0eb', '#B87333']

interface EggParticle {
  x: number; y: number; dx: number; dy: number
  size: number; color: string; delay: number
}

// Three staggered bursts of radiating sparks, sized to the screen
function buildFireworks(w: number, h: number): EggParticle[] {
  const bursts = [
    { x: w * 0.28, y: h * 0.3, delay: 0 },
    { x: w * 0.72, y: h * 0.24, delay: 260 },
    { x: w * 0.5, y: h * 0.46, delay: 520 },
  ]
  const out: EggParticle[] = []
  bursts.forEach((b, bi) => {
    const count = 22
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + bi
      const dist = 90 + Math.random() * 90
      out.push({
        x: b.x,
        y: b.y,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        size: 6 + Math.random() * 8,
        color: EGG_COLORS[Math.floor(Math.random() * EGG_COLORS.length)],
        delay: b.delay + Math.random() * 120,
      })
    }
  })
  return out
}

Page({
  data: {
    announcements: [] as AnnVM[],
    nextMatch: null as NextMatchVM | null,
    activeEvent: null as ActiveEventVM | null,
    season: '',
    loading: true,
    showEgg: false,
    eggBoom: false,
    eggParticles: [] as EggParticle[],
  },

  _eggTaps: 0,
  _eggLastTap: 0,
  _eggTimers: [] as Array<ReturnType<typeof setTimeout>>,

  onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    this.loadData()
  },
  onPullDownRefresh() { this.loadData().finally(() => wx.stopPullDownRefresh()) },

  async loadData() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getAnnouncements' }) as unknown as {
        result: {
          announcements: Announcement[]
          nextMatch: Match | null
          activeEvent: { id: string; title: string; status: string } | null
          season: string
        }
      }
      const { announcements, nextMatch, activeEvent, season } = res.result
      this.setData({
        announcements: announcements.map(a => ({ ...a, contentHtml: markdownToHtml(a.content) })),
        season,
        activeEvent: activeEvent ? {
          id: activeEvent.id,
          title: activeEvent.title,
          statusLabel: activeEvent.status === 'polling' ? '征集意见中' : '报名中',
        } : null,
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

  // Easter egg: ten taps on the 九州 wordmark sets off fireworks
  tapLogo() {
    const now = Date.now()
    // taps must keep coming — a long pause starts the count over
    this._eggTaps = now - this._eggLastTap > 1500 ? 1 : this._eggTaps + 1
    this._eggLastTap = now
    if (this._eggTaps < 10 || this.data.showEgg) return
    this._eggTaps = 0

    const { windowWidth: w, windowHeight: h } = wx.getSystemInfoSync()
    this.setData({ showEgg: true, eggBoom: false, eggParticles: buildFireworks(w, h) })
    wx.vibrateShort({ type: 'medium' })
    this._eggTimers.push(setTimeout(() => this.setData({ eggBoom: true }), 60))
    this._eggTimers.push(setTimeout(() => {
      this.setData({ showEgg: false, eggParticles: [] })
    }, 3000))
  },

  onUnload() {
    this._eggTimers.forEach(clearTimeout)
    this._eggTimers = []
  },

  goToMatch() {
    if (this.data.nextMatch) {
      wx.navigateTo({ url: `/pages/match-detail/index?id=${this.data.nextMatch.id}` })
    }
  },

  goLeaderboard() {
    wx.navigateTo({ url: '/pages/leaderboard/index' })
  },

  goToEvent() {
    if (this.data.activeEvent) {
      wx.navigateTo({ url: `/pages/event-detail/index?id=${this.data.activeEvent.id}` })
    }
  },

  onShareAppMessage() {
    return { title: '九州球队 - 一起踢球吧', path: '/pages/home/index' }
  },
})
