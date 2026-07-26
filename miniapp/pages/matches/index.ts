import type { Match } from '../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE } from '../../utils/format'

const STATUS_NEXT: Record<string, string> = {
  draft: 'registration_r1',
  registration_r1: 'registration_r2',
  registration_r2: 'drafting',
  drafting: 'ready',
  ready: 'completed',
}

// Advance-button copy: action verbs, not the target state's name —
// "选人中" on a button reads like the CURRENT phase.
const ACTION_LABEL: Record<string, string> = {
  registration_r1: '开放 R1 报名',
  registration_r2: '开放 R2 报名',
  drafting: '开始选人',
  ready: '完成选人',
  completed: '标记已结束',
}

interface MatchVM extends Match {
  dateStr: string
  statusLabel: string
  statusBadge: string
  statusDot: string
  isOpen: boolean
  nextStatus: string
  nextStatusLabel: string
  canAdvance: boolean
}

Page({
  data: {
    upcoming: [] as MatchVM[],
    past: [] as MatchVM[],
    loading: true,
    isAdmin: false,
  },

  onShow() {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage'] })
    this.loadMatches()
  },
  onPullDownRefresh() { this.loadMatches().finally(() => wx.stopPullDownRefresh()) },

  async loadMatches() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getMatches' }) as unknown as {
        result: { matches: Match[]; isAdmin: boolean }
      }
      const isAdmin = res.result.isAdmin ?? false
      const all: MatchVM[] = res.result.matches.map(m => ({
        ...m,
        dateStr: formatDate(m.date),
        statusLabel: STATUS_LABEL[m.status] ?? m.status,
        statusBadge: STATUS_BADGE[m.status] ?? 'badge-grey',
        statusDot: m.status === 'drafting' ? 'dot-pulse'
          : ['registration_r1', 'registration_r2', 'ready'].includes(m.status) ? 'dot-teal'
          : m.status === 'cancelled' ? 'dot-red'
          : 'dot-grey',
        isOpen: m.status === 'registration_r1' || m.status === 'registration_r2',
        nextStatus: STATUS_NEXT[m.status] ?? '',
        nextStatusLabel: ACTION_LABEL[STATUS_NEXT[m.status]] ?? '',
        canAdvance: !!STATUS_NEXT[m.status],
      }))
      // admins see draft matches too
      const upcoming = all.filter(m =>
        m.status !== 'completed' && m.status !== 'cancelled' && (isAdmin || m.status !== 'draft')
      )
      // cancelled matches stay visible in 往期 so players can see what happened
      const past = all.filter(m => m.status === 'completed' || m.status === 'cancelled')
      this.setData({ upcoming, past, isAdmin })
    } catch (err) {
      console.error('loadMatches failed', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  goToDetail(e: WechatMiniprogram.BaseEvent) {
    const matchId = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/match-detail/index?id=${matchId}` })
  },

  async advanceStatus(e: WechatMiniprogram.BaseEvent) {
    const { id, next } = e.currentTarget.dataset as { id: string; next: string }
    const label = ACTION_LABEL[next] ?? STATUS_LABEL[next] ?? next
    const res = await wx.showModal({ title: `确认「${label}」？`, content: '', confirmColor: '#00C9A7' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: next } })
      this.loadMatches()
    } catch (err: unknown) {
      console.error('advanceStatus failed', err)
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message
        || '操作失败'
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    }
  },

  async cancelMatch(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const res = await wx.showModal({ title: '确认取消比赛？', content: '此操作不可撤销', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: 'cancelled' } })
      this.loadMatches()
    } catch (err: unknown) {
      console.error('cancelMatch failed', err)
      const msg = (err as { errMsg?: string; message?: string })?.errMsg
        || (err as Error)?.message
        || '操作失败'
      wx.showModal({ title: '操作失败', content: msg, showCancel: false })
    }
  },

  onShareAppMessage() {
    return { title: '九州比赛安排', path: '/pages/matches/index' }
  },
})
