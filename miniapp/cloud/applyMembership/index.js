const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const VALID_TYPES = ['annual', 'per_session']
const TYPE_LABEL = { annual: '年卡', per_session: '次卡' }

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  if (!user) throw new Error('user not found')

  // ── cancel own pending application ─────────────────────────────────────────
  if (event.mode === 'cancel') {
    await db.collection('membershipApplications')
      .where({ uid: user._id, status: 'pending' })
      .update({ data: { status: 'cancelled', decidedAt: db.serverDate() } })
    return { success: true }
  }

  // ── submit ─────────────────────────────────────────────────────────────────
  const { requestedType } = event
  const realName = (event.realName || '').toString().trim()
  const note = (event.note || '').toString().trim().slice(0, 100)

  if (!VALID_TYPES.includes(requestedType)) throw new Error('invalid type')
  if (!realName || realName.length > 20) throw new Error('请填写真实姓名（20字以内）')
  if (user.membershipType === requestedType) {
    throw new Error(`你已经是${TYPE_LABEL[requestedType]}会员`)
  }

  const pendingSnap = await db.collection('membershipApplications')
    .where({ uid: user._id, status: 'pending' })
    .count()
  if ((pendingSnap.total ?? 0) > 0) throw new Error('你已有一个待审批的申请')

  await db.collection('membershipApplications').add({
    data: {
      uid: user._id,
      displayName: user.displayName,
      realName,
      note,
      requestedType,
      currentType: user.membershipType ?? 'none',
      attendanceCount: user.attendanceCount ?? 0,
      status: 'pending',
      createdAt: db.serverDate(),
      decidedBy: null,
      decidedAt: null,
      rejectReason: null,
    },
  })

  // Best-effort WeChat notification to every admin (needs the membershipApplied
  // template ID configured in sendSubscribeMsg; silently skipped until then).
  try {
    const adminsSnap = await db.collection('users').where({ role: 'admin' }).limit(50).get()
    for (const admin of adminsSnap.data) {
      if (!admin.openid) continue
      try {
        await cloud.callFunction({
          name: 'sendSubscribeMsg',
          data: {
            type: 'membershipApplied',
            toOpenid: admin.openid,
            data: {
              page: '/pages/admin/applications/index',
              templateData: {
                thing1: { value: `${realName}（${user.displayName}）`.slice(0, 20) },
                thing2: { value: `申请${TYPE_LABEL[requestedType]}` },
                thing3: { value: (note || '无备注').slice(0, 20) },
              },
            },
          },
        })
      } catch (_) {}
    }
  } catch (_) {}

  return { success: true }
}
