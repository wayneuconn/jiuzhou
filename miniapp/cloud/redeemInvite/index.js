// 邀请 — player side. Burns a single-use code and grants 次卡.
//
// Single use is enforced by a conditional where-update: the row only moves if
// it is still 'open', and the update reports how many rows it touched. Two
// people racing the same code means exactly one of them gets 0 back.
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext()
  const userSnap = await db.collection('users').where({ openid: OPENID }).limit(1).get()
  const user = userSnap.data[0]
  // Redeeming needs an identity to attach the card to. The client stashes the
  // code and calls again once onboarding is done.
  if (!user) return { status: 'needProfile' }

  const code = (event.code || '').toString().trim().toUpperCase()
  if (!code) throw new Error('code required')

  const snap = await db.collection('invites').doc(code).get().catch(() => ({ data: null }))
  const invite = snap.data
  if (!invite) return { status: 'notFound' }
  if (invite.status === 'revoked') return { status: 'revoked' }
  if (invite.status === 'used') {
    // Re-opening the same share link after redeeming shouldn't look like an error
    return { status: invite.usedBy === user._id ? 'alreadyMine' : 'used' }
  }
  if (invite.expiresAt && invite.expiresAt < Date.now()) return { status: 'expired' }

  // Already a member — don't spend the code on someone who gains nothing
  if (user.membershipType === 'annual' || user.membershipType === 'per_session') {
    return { status: 'alreadyMember', membershipType: user.membershipType }
  }

  const claim = await db.collection('invites')
    .where({ _id: code, status: 'open' })
    .update({
      data: {
        status: 'used',
        usedBy: user._id,
        usedByName: user.displayName || '',
        usedAt: db.serverDate(),
      },
    })
    .catch(() => ({ stats: { updated: 0 } }))
  if ((claim.stats?.updated ?? 0) === 0) return { status: 'used' }

  await db.collection('users').doc(user._id).update({ data: { membershipType: 'per_session' } })

  // Let the admin who issued it know it landed
  try {
    const issuerSnap = await db.collection('users').doc(invite.createdBy).get().catch(() => ({ data: null }))
    if (issuerSnap.data?.openid) {
      await cloud.callFunction({
        name: 'sendSubscribeMsg',
        data: {
          type: 'adminAlert',
          toOpenid: issuerSnap.data.openid,
          data: {
            page: '/pages/admin/season/index',
            templateData: {
              thing4: { value: `${user.displayName || '新成员'} 已用邀请加入`.slice(0, 20) },
              thing2: { value: `邀请备注：${invite.note}`.slice(0, 20) },
              date5: { value: new Date().toLocaleString('en-CA', { timeZone: 'America/New_York', hour12: false }).replace(',', '').slice(0, 16) },
            },
          },
        },
      }).catch(() => {})
    }
  } catch (_) {}

  return { status: 'granted', membershipType: 'per_session' }
}
