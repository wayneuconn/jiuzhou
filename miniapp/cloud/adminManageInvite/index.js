// 邀请 — admin side. One code, one person, any time.
//
// Redeeming grants 次卡, which is what unblocks self-registration (new signups
// default to 'none' and cannot register themselves). 年卡 is deliberately NOT
// grantable this way: it still goes through 申请 + 审批.
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// No look-alike characters (0/O, 1/I/l) — codes get read aloud and retyped
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function newCode() {
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

function toMs(v) {
  if (v && typeof v === 'object' && v._seconds) return v._seconds * 1000
  if (v instanceof Date) return v.getTime()
  return v ?? null
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const callerSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = callerSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const { action } = event

  // ── create one invite, for one person ────────────────────────────────────
  if (action === 'create') {
    const note = (event.note || '').toString().trim().slice(0, 50)
    if (!note) throw new Error('请写上这个邀请是给谁的，方便之后对账')
    const days = event.expiresInDays === undefined ? 14 : parseInt(event.expiresInDays, 10)
    if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error('有效期需在 1-365 天之间')

    // Retry on the astronomically unlikely collision rather than overwrite
    let code = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = newCode()
      const clash = await db.collection('invites').doc(candidate).get().catch(() => ({ data: null }))
      if (!clash.data) { code = candidate; break }
    }
    if (!code) throw new Error('邀请码生成失败，请重试')

    await db.collection('invites').doc(code).set({
      data: {
        code,
        note,
        createdBy: caller._id,
        createdByName: caller.displayName || '管理员',
        createdAt: db.serverDate(),
        expiresAt: Date.now() + days * 864e5,
        status: 'open',
        usedBy: null,
        usedByName: null,
        usedAt: null,
      },
    })
    return { success: true, code }
  }

  // ── list, newest first ───────────────────────────────────────────────────
  if (!action || action === 'list') {
    const snap = await db.collection('invites')
      .orderBy('createdAt', 'desc').limit(100).get().catch(() => ({ data: [] }))
    const now = Date.now()
    return {
      invites: snap.data.map(i => ({
        ...i,
        id: i._id,
        createdAt: toMs(i.createdAt),
        usedAt: toMs(i.usedAt),
        // Expiry is a read-time fact, not a stored state — no cron needed
        expired: i.status === 'open' && !!i.expiresAt && i.expiresAt < now,
      })),
    }
  }

  // ── revoke an unused one ─────────────────────────────────────────────────
  if (action === 'revoke') {
    const code = (event.code || '').toString().trim().toUpperCase()
    if (!code) throw new Error('code required')
    const snap = await db.collection('invites').doc(code).get().catch(() => ({ data: null }))
    if (!snap.data) throw new Error('邀请码不存在')
    if (snap.data.status === 'used') throw new Error('该邀请已被使用，无法撤回')
    await db.collection('invites').doc(code).update({ data: { status: 'revoked' } })
    return { success: true }
  }

  throw new Error('unknown action')
}
