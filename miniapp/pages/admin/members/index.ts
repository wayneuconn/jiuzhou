import type { User } from '../../../types/index'

const MEMBERSHIP_LABEL: Record<string, string> = { annual: '年卡', per_session: '次卡', none: '未激活' }
const MEMBERSHIP_BADGE: Record<string, string> = { annual: 'badge-teal', per_session: 'badge-gold', none: 'badge-grey' }
const ROLE_LABEL: Record<string, string> = { admin: '管理员', member: '会员', guest: '访客' }

type MemberVM = User & { id: string; membershipLabel: string; membershipBadge: string; roleLabel: string; isBanned: boolean }

const FILTERS = [
  { key: 'nonAnnual', label: '非年卡' },
  { key: 'annual', label: '年卡' },
  { key: 'all', label: '全部' },
]

// createdAt may arrive as ISO string / {_seconds} / number depending on how
// the serverDate serialized — normalize for sorting
function toMs(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return new Date(v).getTime() || 0
  if (v && typeof v === 'object' && (v as { _seconds?: number })._seconds) {
    return ((v as { _seconds: number })._seconds) * 1000
  }
  return 0
}

Page({
  data: {
    members: [] as MemberVM[],
    filteredMembers: [] as MemberVM[],
    filters: FILTERS,
    filter: 'nonAnnual',
    loading: true,
  },

  onShow() { this.loadMembers() },

  async loadMembers() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'adminGetMembers' }) as unknown as { result: { members: (User & { id: string })[] } }
      const members: MemberVM[] = res.result.members
        .map(u => ({
          ...u,
          membershipLabel: MEMBERSHIP_LABEL[u.membershipType] ?? u.membershipType,
          membershipBadge: MEMBERSHIP_BADGE[u.membershipType] ?? 'badge-grey',
          roleLabel: ROLE_LABEL[u.role] ?? u.role,
          isBanned: (u.banGamesLeft ?? 0) > 0,
        }))
        .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
      this.setData({ members }, () => this.applyFilter())
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  applyFilter() {
    const { members, filter } = this.data
    const filteredMembers =
      filter === 'annual' ? members.filter(m => m.membershipType === 'annual')
      : filter === 'nonAnnual' ? members.filter(m => m.membershipType !== 'annual')
      : members
    this.setData({ filteredMembers })
  },

  setFilter(e: WechatMiniprogram.BaseEvent) {
    const key = (e.currentTarget.dataset as { key: string }).key
    this.setData({ filter: key }, () => this.applyFilter())
  },

  async changeMembership(e: WechatMiniprogram.BaseEvent) {
    const { id, current } = e.currentTarget.dataset as { id: string; current: string }
    // showActionSheet rejects when dismissed — treat that as "no choice"
    const res = await wx.showActionSheet({ itemList: ['年卡 (annual)', '次卡 (per_session)', '未激活 (none)'] }).catch(() => null)
    if (!res) return
    const typeMap = ['annual', 'per_session', 'none']
    const chosen = typeMap[res.tapIndex]
    if (!chosen || chosen === current) return
    try {
      await wx.cloud.callFunction({ name: 'adminUpdateUser', data: { uid: id, membershipType: chosen } })
      wx.showToast({ title: '已更新', icon: 'success' })
      this.loadMembers()
    } catch (err: unknown) { this._showError(err) }
  },

  async changeRole(e: WechatMiniprogram.BaseEvent) {
    const { id, current } = e.currentTarget.dataset as { id: string; current: string }
    const app = getApp<{ globalData: { userProfile: { _id: string } | null } }>()
    if (id === app.globalData.userProfile?._id) { wx.showToast({ title: '不能修改自己', icon: 'none' }); return }
    const res = await wx.showActionSheet({ itemList: ['管理员 (admin)', '会员 (member)', '访客 (guest)'] }).catch(() => null)
    if (!res) return
    const roleMap = ['admin', 'member', 'guest']
    const chosen = roleMap[res.tapIndex]
    if (!chosen || chosen === current) return
    try {
      await wx.cloud.callFunction({ name: 'adminUpdateUser', data: { uid: id, role: chosen } })
      wx.showToast({ title: '已更新', icon: 'success' })
      this.loadMembers()
    } catch (err: unknown) { this._showError(err) }
  },

  async banPlayer(e: WechatMiniprogram.BaseEvent) {
    const { id, current } = e.currentTarget.dataset as { id: string; current: number }
    const isBanned = (current ?? 0) > 0
    const itemList = isBanned
      ? ['解禁', '禁赛 1 场', '禁赛 2 场', '禁赛 3 场', '禁赛 5 场', '禁赛 10 场']
      : ['禁赛 1 场', '禁赛 2 场', '禁赛 3 场', '禁赛 5 场', '禁赛 10 场']
    const gameMap = isBanned ? [0, 1, 2, 3, 5, 10] : [1, 2, 3, 5, 10]
    const res = await wx.showActionSheet({ itemList }).catch(() => null)
    if (!res) return
    const games = gameMap[res.tapIndex]
    if (games === undefined) return
    try {
      await wx.cloud.callFunction({ name: 'adminUpdateUser', data: { uid: id, banGamesLeft: games } })
      wx.showToast({ title: games === 0 ? '已解禁' : `已禁赛 ${games} 场`, icon: 'success' })
      this.loadMembers()
    } catch (err: unknown) { this._showError(err) }
  },

  _showError(err: unknown) {
    const msg = (err as { errMsg?: string; message?: string })?.errMsg
      || (err as Error)?.message || '操作失败'
    wx.showModal({ title: '操作失败', content: msg, showCancel: false })
  },
})
