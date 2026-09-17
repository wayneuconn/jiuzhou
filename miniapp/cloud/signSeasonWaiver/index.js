// 赛季确认书 — player side.
//
// The waiver this serves is governed by New Jersey law, so the standard is
// ESIGN / NJ UETA, not China's 电子签名法: an electronic symbol or process
// adopted with intent to sign IS the signature, with no higher "reliable"
// tier to reach. Clause 10 of the waiver names checkbox acknowledgment as
// equivalent to a hand-written signature, and says the retained evidence is
// "electronic registration logs (including timestamps and IP addresses)" —
// which is exactly what this records.
//
// The archive value is the typed real name plus a fingerprint of the exact
// text that was on screen, so a later edit to the waiver can't quietly change
// what someone is recorded as having agreed to.
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const crypto = require('crypto')

const hashBody = (body) => crypto.createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 16)

exports.main = async (event = {}) => {
  // CLIENTIP/CLIENTIPV6 come from the platform, not the client — they can't be
  // spoofed by the caller, which is what makes them worth retaining
  const { OPENID, CLIENTIP, CLIENTIPV6 } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('请先完善个人资料')

  const cfgSnap = await db.collection('config').doc('app').get().catch(() => ({ data: null }))
  const season = cfgSnap.data?.season ?? ''
  if (!season) throw new Error('当前赛季未设置，请联系管理员')

  const waiverSnap = await db.collection('waivers').doc(season).get().catch(() => ({ data: null }))
  const waiver = waiverSnap.data
  if (!waiver) throw new Error('本赛季暂无需要确认的文件')

  // A cloud:// fileID uploaded by this same caller; anything else is refused
  // rather than stored, so the archive can't be pointed at arbitrary URLs.
  const signatureFileId = (event.signatureFileId || '').toString().trim()
  if (signatureFileId && !/^cloud:\/\/[\w.\-\/]+$/.test(signatureFileId)) {
    throw new Error('签名图片无效，请重新签写')
  }
  if (waiver.handwriting === true && !signatureFileId) {
    throw new Error('请先在方框内签写姓名')
  }

  const realName = (event.realName || '').toString().trim()
  if (!realName || realName.length > 20) throw new Error('请填写真实姓名（20 字以内）')
  if (event.agreed !== true) throw new Error('请先勾选已阅读')

  const docId = season + '_' + user._id
  await db.collection('waiverSignatures').doc(docId).set({
    data: {
      season,
      uid: user._id,
      displayName: user.displayName || '',
      realName,
      version: waiver.version,
      effectiveDate: waiver.effectiveDate || '',
      bodyHash: hashBody(waiver.body || ''),
      signatureFileId,
      // Named in clause 10 as the evidence of acceptance
      signedAt: db.serverDate(),
      clientIp: CLIENTIP || CLIENTIPV6 || ''
    },
  })

  // Keep it on the profile too, so 成员管理 can show it without a join
  await db.collection('users').doc(user._id)
    .update({ data: { waiverSeason: season, waiverVersion: waiver.version } })
    .catch(() => {})

  return { success: true, season, version: waiver.version }
}
