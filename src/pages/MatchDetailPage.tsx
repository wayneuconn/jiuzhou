import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  doc,
  getDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/authStore'
import type { Match, Registration } from '../types'

export default function MatchDetailPage() {
  const { matchId } = useParams<{ matchId: string }>()
  const { userProfile } = useAuthStore()
  const [match, setMatch] = useState<Match | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [loading, setLoading] = useState(true)
  const [agreementOpen, setAgreementOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')

  const myReg = registrations.find((r) => r.uid === userProfile?.uid)
  const roster = registrations.filter((r) => r.status === 'confirmed' || r.status === 'promoted')
  const waitlist = registrations.filter((r) => r.status === 'waitlist').sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))

  useEffect(() => {
    if (!matchId) return
    const load = async () => {
      const snap = await getDoc(doc(db, 'matches', matchId))
      if (snap.exists()) {
        setMatch({ id: snap.id, ...snap.data(), date: snap.data().date?.toDate(), createdAt: snap.data().createdAt?.toDate() } as Match)
      }
      setLoading(false)
    }
    load()

    const unsubReg = onSnapshot(
      query(collection(db, 'matches', matchId, 'registrations'), orderBy('registeredAt', 'asc')),
      (snap) => {
        setRegistrations(snap.docs.map((d) => ({ ...d.data(), registeredAt: d.data().registeredAt?.toDate() })) as Registration[])
      }
    )
    return unsubReg
  }, [matchId])

  const handleRegister = async () => {
    if (!match || !userProfile || !matchId) return
    setAgreementOpen(false)
    setActionLoading(true)
    setError('')
    try {
      const regRef = doc(db, 'matches', matchId, 'registrations', userProfile.uid)
      await runTransaction(db, async (tx) => {
        const regSnap = await tx.get(regRef)
        if (regSnap.exists()) throw new Error('Already registered.')
        const confirmedCount = roster.length
        const status = confirmedCount < match.maxPlayers ? 'confirmed' : 'waitlist'
        const waitlistPosition = status === 'waitlist' ? waitlist.length + 1 : null
        tx.set(regRef, {
          uid: userProfile.uid,
          displayName: userProfile.displayName,
          registeredAt: serverTimestamp(),
          status,
          waitlistPosition,
          promotedAt: null,
          confirmDeadline: null,
          team: null,
        })
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Registration failed.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleWithdraw = async () => {
    if (!userProfile || !matchId) return
    setActionLoading(true)
    setError('')
    try {
      const regRef = doc(db, 'matches', matchId, 'registrations', userProfile.uid)
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(regRef)
        if (!snap.exists()) throw new Error('Not registered.')
        tx.update(regRef, { status: 'withdrawn' })
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Withdrawal failed.')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  if (!match) return <p className="text-gray-500">Match not found.</p>

  const canRegister = !myReg && ['registration_r1', 'registration_r2'].includes(match.status) &&
    (match.status === 'registration_r1' ? userProfile?.membershipStatus === 'active' : true)

  return (
    <div className="space-y-6">
      {/* Match Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-800">
          {match.date?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h1>
        <p className="text-gray-500 mt-1">{match.location}</p>
        <span className="inline-block mt-2 text-xs font-semibold bg-green-100 text-green-700 px-3 py-1 rounded-full capitalize">
          {match.status.replace('_', ' ')}
        </span>
      </div>

      {/* Action Button */}
      {error && <p className="text-red-500 text-sm">{error}</p>}

      {canRegister && (
        <button
          onClick={() => setAgreementOpen(true)}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          Sign Up ({roster.length}/{match.maxPlayers})
        </button>
      )}

      {myReg && myReg.status !== 'withdrawn' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-green-700 capitalize">{myReg.status}</p>
            {myReg.status === 'waitlist' && (
              <p className="text-sm text-green-600">Position #{myReg.waitlistPosition}</p>
            )}
          </div>
          <button
            onClick={handleWithdraw}
            disabled={actionLoading}
            className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            Withdraw
          </button>
        </div>
      )}

      {/* Roster */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Roster ({roster.length}/{match.maxPlayers})
        </h2>
        {roster.length === 0 ? (
          <p className="text-gray-400 text-sm">No one signed up yet.</p>
        ) : (
          <div className="space-y-2">
            {roster.map((r, i) => (
              <div key={r.uid} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3">
                <span className="w-6 text-center text-sm font-bold text-gray-400">{i + 1}</span>
                <span className="font-medium text-gray-800 flex-1">{r.displayName}</span>
                {r.team && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${r.team === 'A' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                    Team {r.team}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Waitlist */}
      {waitlist.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Waitlist ({waitlist.length})
          </h2>
          <div className="space-y-2">
            {waitlist.map((r) => (
              <div key={r.uid} className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                <span className="w-6 text-center text-sm font-bold text-gray-400">#{r.waitlistPosition}</span>
                <span className="font-medium text-gray-600 flex-1">{r.displayName}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Agreement Modal */}
      {agreementOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-800 text-lg">Registration Agreement</h3>
            <p className="text-gray-600 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto">
              {match.agreementText || 'By signing up, you agree to follow the team code of conduct and attend the match you register for.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setAgreementOpen(false)}
                className="flex-1 border border-gray-300 py-3 rounded-xl font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRegister}
                disabled={actionLoading}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                I Agree
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
