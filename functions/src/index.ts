import * as admin from 'firebase-admin'
import { onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { FieldValue } from 'firebase-admin/firestore'

admin.initializeApp()
const db = admin.firestore()

// ─── promoteFromWaitlist ────────────────────────────────────────────────────
export const promoteFromWaitlist = onDocumentUpdated(
  'matches/{matchId}/registrations/{uid}',
  async (event) => {
    const before = event.data?.before.data()
    const after = event.data?.after.data()
    if (!before || !after) return

    if (after.status !== 'withdrawn' || !['confirmed', 'promoted'].includes(before.status)) {
      return
    }

    const { matchId } = event.params
    const matchRef = db.doc(`matches/${matchId}`)
    const regsRef = db.collection(`matches/${matchId}/registrations`)

    await db.runTransaction(async (tx) => {
      const matchSnap = await tx.get(matchRef)
      const config = await tx.get(db.doc('config/main'))
      const waitlistMinutes: number = config.exists ? (config.data()!.waitlistConfirmMinutes ?? 30) : 30

      if (!matchSnap.exists) return

      const waitlistSnap = await regsRef
        .where('status', '==', 'waitlist')
        .orderBy('waitlistPosition', 'asc')
        .limit(1)
        .get()

      if (waitlistSnap.empty) return

      const topWaiter = waitlistSnap.docs[0]
      const deadline = new Date(Date.now() + waitlistMinutes * 60 * 1000)

      tx.update(topWaiter.ref, {
        status: 'promoted',
        promotedAt: FieldValue.serverTimestamp(),
        confirmDeadline: deadline,
        waitlistPosition: null,
      })
    })
  }
)

// ─── processDraftPick ──────────────────────────────────────────────────────
export const processDraftPick = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.')

  const { matchId, pickedUid } = request.data as { matchId: string; pickedUid: string }
  const callerUid = request.auth.uid
  const matchRef = db.doc(`matches/${matchId}`)

  return db.runTransaction(async (tx) => {
    const matchSnap = await tx.get(matchRef)
    if (!matchSnap.exists) throw new HttpsError('not-found', 'Match not found.')

    const match = matchSnap.data()!
    if (match.status !== 'drafting') {
      throw new HttpsError('failed-precondition', 'Draft is not active.')
    }

    const draftState = match.draftState
    if (callerUid !== draftState.currentTurn) {
      throw new HttpsError('permission-denied', 'Not your turn.')
    }

    const team = callerUid === match.captainA ? 'A' : 'B'
    const regRef = db.doc(`matches/${matchId}/registrations/${pickedUid}`)
    tx.update(regRef, { team })

    const picks = [...(draftState.picks || []), {
      uid: pickedUid,
      pickedBy: callerUid,
      pickNumber: (draftState.picks || []).length + 1,
    }]
    const nextIndex = picks.length
    const nextTurn = nextIndex < draftState.pickOrder.length ? draftState.pickOrder[nextIndex] : null

    tx.update(matchRef, {
      'draftState.picks': picks,
      'draftState.currentTurn': nextTurn,
    })

    return { success: true, nextTurn }
  })
})

// ─── generateInviteLink ───────────────────────────────────────────────────
export const generateInviteLink = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.')

  const userSnap = await db.doc(`users/${request.auth.uid}`).get()
  if (!userSnap.exists || userSnap.data()!.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admins only.')
  }

  const token = db.collection('inviteTokens').doc().id
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  await db.doc(`inviteTokens/${token}`).set({
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    used: false,
  })

  return { token }
})

// ─── confirmationTimeout ──────────────────────────────────────────────────
export const confirmationTimeout = onSchedule('every 5 minutes', async () => {
  const now = new Date()

  const matchesSnap = await db
    .collection('matches')
    .where('status', 'in', ['registration_r1', 'registration_r2'])
    .get()

  for (const matchDoc of matchesSnap.docs) {
    const expiredSnap = await db
      .collection(`matches/${matchDoc.id}/registrations`)
      .where('status', '==', 'promoted')
      .where('confirmDeadline', '<', now)
      .get()

    for (const expiredReg of expiredSnap.docs) {
      await expiredReg.ref.update({
        status: 'waitlist',
        promotedAt: null,
        confirmDeadline: null,
        waitlistPosition: 999,
      })

      const config = await db.doc('config/main').get()
      const waitlistMinutes: number = config.exists ? (config.data()!.waitlistConfirmMinutes ?? 30) : 30

      const nextSnap = await db
        .collection(`matches/${matchDoc.id}/registrations`)
        .where('status', '==', 'waitlist')
        .orderBy('waitlistPosition', 'asc')
        .limit(1)
        .get()

      if (!nextSnap.empty) {
        const deadline = new Date(Date.now() + waitlistMinutes * 60 * 1000)
        await nextSnap.docs[0].ref.update({
          status: 'promoted',
          promotedAt: FieldValue.serverTimestamp(),
          confirmDeadline: deadline,
          waitlistPosition: null,
        })
      }
    }
  }
})
