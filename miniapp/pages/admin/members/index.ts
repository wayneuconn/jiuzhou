import type { User } from '../../../types/index'

const MEMBERSHIP_LABEL: Record<string, string> = { annual: '年卡', per_session: '次卡', none: '未激活' }
const MEMBERSHIP_BADGE: Record<string, string> = { annual: 'badge-teal', per_session: 'badge-gold', none: 'badge-grey' }
const ROLE_LABEL: Record<string, string> = { admin: '管理员', member: '会员', guest: '访客' }

type MemberVM = User & { id: string; membershipLabel: string; membershipBadge: string; roleLabel: string; isBanned: boolean }

Page({
  data: {
    members: [] as MemberVM[],
    loading: true,
  },

  onShow() { this.loadMembers() },

  async loadMembers() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({ name: 'adminGetMembers' }) as unknown as { result: { members: (User & { id: string })[] } }
      const members: MemberVM[] = res.result.members.map(u => ({
        ...u,
        membershipLabel: MEMBERSHIP_LABEL[u.membershipType] ?? u.membershipType,
        membershipBadge: MEMBERSHIP_BADGE[u.membershipType] ?? 'badge-grey',
        roleLabel: ROLE_LABEL[u.role] ?? u.role,
        isBanned: (u.banGamesLeft ?? 0) > 0,
      }))
      this.setData({ members })
    } catch (err) { console.error(err) }
    finally { this.setData({ loading: false }) }
  },

  async changeMembership(e: WechatMiniprogram.BaseEvent) {
    const { id, current } = e.currentTarget.dataset as { id: string; current: string }
    const res = await wx.showActionSheet({ itemList: ['年卡 (annual)', '次卡 (per_session)', '未激活 (none)'] })
    const typeMap = ['annual', 'per_session', 'none']
    const chosen = typeMap[res.tapIndex]
    if (!chosen || chosen === current) return
    try {
      await wx.cloud.callFunction({ name: 'adminUpdateUser', data: { uid: id, membershipType: chosen } })
      wx.showToast({ title: '已更新', icon: 'success' })
      this.loadMembers()
    } catch { wx.showToast({ title: '操作失败', icon: 'error' }) }
  },

  async changeRole(e: WechatMiniprogram.BaseEvent) {
    const { id, current } = e.currentTarget.dataset as { id: string; current: string }
    const app = getApp<{ globalData: { userProfile: { _id: string } | null } }>()
    if (id === app.globalData.userProfile?._id) { wx.showToast({ title: '不能修改自己', icon: 'none' }); return }
    const res = await wx.showActionSheet({ itemList: ['管理员 (admin)', '会员 (member)', '访客 (guest)'] })
    const roleMap = ['admin', 'member', 'guest']
    const chosen = roleMap[res.tapIndex]
    if (!chosen || chosen === current) return
    try {
      await wx.cloud.callFunction({ name: 'adminUpdateUser', data: { uid: id, role: chosen } })
      wx.showToast({ title: '已更新', icon: 'success' })
      this.loadMembers()
    } catch { wx.showToast({ title: '操作失败', icon: 'error' }) }
  },

  async banPlayer(e: WechatMiniprogram.BaseEvent) {
    const { id, current } = e.currentTarget.dataset as { id: string; current: number }
    const isBanned = (current ?? 0) > 0
    const itemList = isBanned
      ? ['解禁', '禁赛 1 场', '禁赛 2 场', '禁赛 3 场', '禁赛 5 场', '禁赛 10 场']
      : ['禁赛 1 场', '禁赛 2 场', '禁赛 3 场', '禁赛 5 场', '禁赛 10 场']
    const gameMap = isBanned ? [0, 1, 2, 3, 5, 10] : [1, 2, 3, 5, 10]
    const res = await wx.showActionSheet({ itemList })
    const games = gameMap[res.tapIndex]
    if (games === undefined) return
    try {
      await wx.cloud.callFunction({ name: 'adminUpdateUser', data: { uid: id, banGamesLeft: games } })
      wx.showToast({ title: games === 0 ? '已解禁' : `已禁赛 ${games} 场`, icon: 'success' })
      this.loadMembers()
    } catch { wx.showToast({ title: '操作失败', icon: 'error' }) }
  },
})
