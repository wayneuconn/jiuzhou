// 赛季确认书 — admin side.
//
// Serves a New Jersey-governed liability waiver, so the standard is ESIGN /
// NJ UETA: a checkbox adopted with intent to sign IS the signature. Clause 10
// of the waiver says so outright and names the evidence to keep — timestamps
// and IP addresses — which signSeasonWaiver records per confirmation.
//
// Versioning exists because clause 10 also requires the current text to be
// kept with its effective date: a signature is stored against the version and
// body hash it was given, so editing the document can't retroactively change
// what anyone is recorded as having accepted.
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const crypto = require('crypto')

function toMs(v) {
  if (v && typeof v === 'object' && v._seconds) return v._seconds * 1000
  if (v instanceof Date) return v.getTime()
  return v ?? null
}

const hashBody = (body) => crypto.createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 16)

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const callerSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const caller = callerSnap.data[0]
  if (!caller || caller.role !== 'admin') throw new Error('admins only')

  const { action } = event
  const cfgSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const season = (event.season || cfgSnap.data?.season || '').toString().trim()
  if (!season) throw new Error('请先在系统设置里填写赛季名称')

  // ── who has confirmed, who hasn't ────────────────────────────────────────
  if (!action || action === 'board') {
    const [waiverSnap, sigSnap, usersSnap] = await Promise.all([
      db.collection('waivers').doc(season).get().catch(() => ({ data: null })),
      db.collection('waiverSignatures').where({ season }).limit(500).get().catch(() => ({ data: [] })),
      db.collection('users')
        .where({ membershipType: db.command.in(['annual', 'per_session']) })
        .limit(300).get().catch(() => ({ data: [] })),
    ])
    const waiver = waiverSnap.data
    const signatures = sigSnap.data.map(s => ({ ...s, id: s._id, signedAt: toMs(s.signedAt) }))
    // A signature against an older version no longer counts as confirmed
    const current = new Set(
      signatures.filter(s => !waiver || s.version === waiver.version).map(s => s.uid),
    )
    return {
      season,
      waiver: waiver ? { ...waiver, updatedAt: toMs(waiver.updatedAt) } : null,
      signatures: signatures.sort((a, b) => (b.signedAt ?? 0) - (a.signedAt ?? 0)),
      pending: usersSnap.data
        .filter(u => !current.has(u._id))
        .map(u => ({ uid: u._id, displayName: u.displayName, membershipType: u.membershipType })),
    }
  }

  // ── write / update the text ──────────────────────────────────────────────
  if (action === 'save') {
    const title = (event.title || '').toString().trim().slice(0, 50)
    // Clause 10 (Updates): the current version is kept with its effective date
    const effectiveDate = (event.effectiveDate || '').toString().trim().slice(0, 20)
    const body = (event.body || '').toString().trim()
    if (!title) throw new Error('请填写标题')
    if (!body) throw new Error('请填写正文')
    if (body.length > 20000) throw new Error('正文太长（上限 20000 字）')

    const existing = await db.collection('waivers').doc(season).get().catch(() => ({ data: null }))
    // Editing a typo keeps everyone's confirmation; only an explicit reset
    // bumps the version and sends everyone back through it.
    const bumped = event.requireResign === true
    const version = (existing.data?.version ?? 0) + (existing.data ? (bumped ? 1 : 0) : 1)

    await db.collection('waivers').doc(season).set({
      data: {
        season,
        title,
        body,
        effectiveDate,
        version,
        required: event.required !== false,
        updatedAt: db.serverDate(),
        updatedBy: caller._id,
      },
    })
    return { success: true, season, version, requiredResign: bumped }
  }

  // ── stop gating registration without deleting the archive ────────────────
  if (action === 'setRequired') {
    const existing = await db.collection('waivers').doc(season).get().catch(() => ({ data: null }))
    if (!existing.data) throw new Error('本赛季还没有确认书')
    await db.collection('waivers').doc(season).update({ data: { required: event.required === true } })
    return { success: true }
  }

  throw new Error('unknown action')
}
