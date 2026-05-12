import type { Match } from '../../../types/index'
import { formatDate, STATUS_LABEL, STATUS_BADGE } from '../../../utils/format'

const STATUS_NEXT: Record<string, string> = {
  draft: 'registration_r1',
  registration_r1: 'registration_r2',
  registration_r2: 'drafting',
  drafting: 'ready',
  ready: 'completed',
}

interface MatchVM extends Match {
  dateStr: string
  statusLabel: string
  statusBadge: string
  nextStatus: string
  nextStatusLabel: string
  canAdvance: boolean
  canForceReady: boolean
  canBackToR2: boolean
}

const todayDateStr = () => new Date().toISOString().slice(0, 10)

Page({
  data: {
    matches: [] as MatchVM[],
    filteredMatches: [] as MatchVM[],
    showAll: false,
    loading: true,
    showCreateModal: false,
    creating: false,
    form: { location: '', maxPlayers: 22, date: todayDateStr() },
  },

  onShow() { this.loadMatches() },

  async loadMatches() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'getMatches' }) as unknown as { result: { matches: Match[] } }
      const matches: MatchVM[] = res.result.matches.map(m => ({
        ...m,
        dateStr: formatDate(m.date),
        statusLabel: STATUS_LABEL[m.status] ?? m.status,
        statusBadge: STATUS_BADGE[m.status] ?? 'badge-grey',
        nextStatus: STATUS_NEXT[m.status] ?? '',
        nextStatusLabel: STATUS_LABEL[STATUS_NEXT[m.status]] ?? '',
        canAdvance: !!STATUS_NEXT[m.status] && m.status !== 'completed' && m.status !== 'cancelled',
        canForceReady: m.status === 'registration_r1' || m.status === 'registration_r2',
        canBackToR2: m.status === 'ready',
      }))
      this.setData({ matches }, () => this.applyFilter())
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  applyFilter() {
    const { matches, showAll } = this.data
    const filteredMatches = showAll
      ? matches
      : matches.filter(m => m.status !== 'completed' && m.status !== 'cancelled')
    this.setData({ filteredMatches })
  },

  toggleShowAll() {
    this.setData({ showAll: !this.data.showAll }, () => this.applyFilter())
  },

  openCreateModal() { this.setData({ showCreateModal: true }) },
  closeCreateModal() { this.setData({ showCreateModal: false }) },

  onFormLocation(e: WechatMiniprogram.Input) { this.setData({ 'form.location': e.detail.value }) },
  onFormPlayers(e: WechatMiniprogram.Input) { this.setData({ 'form.maxPlayers': Number(e.detail.value) || 22 }) },
  onFormDate(e: WechatMiniprogram.BaseEvent & { detail: { value: string } }) { this.setData({ 'form.date': e.detail.value }) },

  async createMatch() {
    const { location, maxPlayers, date } = this.data.form
    if (!location.trim()) { wx.showToast({ title: '请填写地点', icon: 'none' }); return }
    this.setData({ creating: true })
    try {
      const d = new Date(date + 'T20:00:00')
      await wx.cloud.callFunction({
        name: 'createMatch',
        data: { location: location.trim(), maxPlayers, date: d.getTime() },
      })
      wx.showToast({ title: '比赛已创建', icon: 'success' })
      this.setData({ showCreateModal: false, 'form.location': '' })
      this.loadMatches()
    } catch (err: unknown) {
      wx.showToast({ title: (err as Error).message || '创建失败', icon: 'none' })
    } finally { this.setData({ creating: false }) }
  },

  async advanceStatus(e: WechatMiniprogram.BaseEvent) {
    const { id, next } = e.currentTarget.dataset as { id: string; next: string }
    const label = STATUS_LABEL[next] ?? next
    const res = await wx.showModal({ title: `确认改为「${label}」？`, content: '', confirmColor: '#00C9A7' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: next } })
      this.loadMatches()
    } catch { wx.showToast({ title: '操作失败', icon: 'error' }) }
  },

  async forceReady(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const res = await wx.showModal({ title: '强制设为已就绪？', content: '即使人数不足也将锁定名单', confirmColor: '#00C9A7' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: 'ready' } })
      this.loadMatches()
    } catch { wx.showToast({ title: '操作失败', icon: 'error' }) }
  },

  async backToR2(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const res = await wx.showModal({ title: '回到 R2 报名？', content: '重新开放报名', confirmColor: '#F0B429' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: 'registration_r2' } })
      this.loadMatches()
    } catch { wx.showToast({ title: '操作失败', icon: 'error' }) }
  },

  async cancelMatch(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    const res = await wx.showModal({ title: '确认取消比赛？', content: '此操作不可撤销', confirmColor: '#E53E3E' })
    if (!res.confirm) return
    try {
      await wx.cloud.callFunction({ name: 'updateMatchStatus', data: { matchId: id, status: 'cancelled' } })
      this.loadMatches()
    } catch { wx.showToast({ title: '操作失败', icon: 'error' }) }
  },

  goDetail(e: WechatMiniprogram.BaseEvent) {
    const id = (e.currentTarget.dataset as { id: string }).id
    wx.navigateTo({ url: `/pages/match-detail/index?id=${id}` })
  },

  noop() {},
})
