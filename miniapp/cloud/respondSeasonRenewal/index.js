// 赛季年卡登记 — player side. Declaring intent only; an admin confirms it
// afterwards, because the handshake happens outside the app.
//
// Birthday: month and day only, no year. It's 个人信息 under PIPL (not
// 敏感个人信息), and MM-DD is a far weaker identifier than a full date while
// still serving the purpose, which keeps the 最小必要 story clean. It must be
// declared in the mini program's 用户隐私保护指引 before this ships.
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

// 'MM-DD' → normalized 'MM-DD', or null if it isn't a real day
function normalizeBirthday(raw) {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec((raw || '').toString().trim())
  if (!m) return null
  const month = parseInt(m[1], 10)
  const day = parseInt(m[2], 10)
  if (month < 1 || month > 12) return null
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return null
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('请先完善个人资料')

  const { response } = event
  if (!['continue', 'decline'].includes(response)) throw new Error('invalid response')

  // The one open drive; nothing to respond to otherwise
  const driveSnap = await db.collection('seasonDrives')
    .where({ status: 'open' }).orderBy('openedAt', 'desc').limit(1).get().catch(() => ({ data: [] }))
  const drive = driveSnap.data[0]
  if (!drive) throw new Error('当前没有开放的赛季年卡登记')
  if (drive.deadline && Date.now() > drive.deadline) throw new Error('登记已截止，请联系管理员')

  const season = drive.season
  const docId = season + '_' + user._id
  const existing = await db.collection('seasonRenewals').doc(docId).get().catch(() => ({ data: null }))
  // Once an admin has confirmed, the player can't quietly undo it
  if (existing.data?.status === 'confirmed') throw new Error('已登记完成，如需变更请联系管理员')

  const note = (event.note || '').toString().trim().slice(0, 100)

  let birthday = existing.data?.birthday ?? null
  if (response === 'continue') {
    // Required on continue — declining doesn't need it
    const supplied = event.birthday !== undefined && event.birthday !== null && event.birthday !== ''
    const given = normalizeBirthday(event.birthday)
    // Order matters: a supplied-but-unparseable value is a format problem, and
    // saying "please fill it in" would send them looking for an empty field
    if (supplied && !given) throw new Error('生日格式不对，请选择有效的月和日')
    if (!given && !birthday) throw new Error('请填写生日（月-日）')
    if (given) birthday = given
  }

  await db.collection('seasonRenewals').doc(docId).set({
    data: {
      season,
      uid: user._id,
      displayName: user.displayName,
      response,
      birthday,
      note,
      // A fresh response always goes back to pending review
      status: 'pending',
      respondedAt: db.serverDate(),
      decidedBy: null,
      decidedAt: null,
    },
  })

  // Keep the profile copy in step, so the roster has it without a join
  if (birthday) {
    await db.collection('users').doc(user._id).update({ data: { birthday } }).catch(() => {})
  }

  // Tell the admins there's something to confirm
  if (response === 'continue') {
    try {
      const adminsSnap = await db.collection('users').where({ role: 'admin' }).limit(50).get()
      const timeStr = new Date().toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16)
      for (const admin of adminsSnap.data) {
        if (!admin.openid) continue
        await cloud.callFunction({
          name: 'sendSubscribeMsg',
          data: {
            type: 'adminAlert',
            toOpenid: admin.openid,
            data: {
              page: '/pages/admin/season/index',
              templateData: {
                thing4: { value: `${user.displayName || '球员'} 确认继续年卡`.slice(0, 20) },
                thing2: { value: `${season} 赛季,待你确认登记`.slice(0, 20) },
                date5: { value: timeStr },
              },
            },
          },
        }).catch(() => {})
      }
    } catch (_) {}
  }

  return { success: true, season, response }
}
