import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  doc, getDoc, collection, onSnapshot, query, orderBy,
  runTransaction, serverTimestamp,
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
  const waitlist = registrations
    .filter((r) => r.status === 'waitlist')
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))

  useEffect(() => {
    if (!matchId) return
    getDoc(doc(db, 'matches', matchId)).then((snap) => {
      if (snap.exists()) {
        setMatch({ id: snap.id, ...snap.data(), date: snap.data().date?.toDate(), createdAt: snap.data().createdAt?.toDate() } as Match)
      }
      setLoading(false)
    })
    return onSnapshot(
      query(collection(db, 'matches', matchId, 'registrations'), orderBy('registeredAt', 'asc')),
      (snap) => setRegistrations(snap.docs.map((d) => ({ ...d.data(), registeredAt: d.data().registeredAt?.toDate() })) as Registration[])
    )
  }, [matchId])

  const handleRegister = async () => {
    if (!match || !userProfile || !matchId) return
    setAgreementOpen(false)
    setActionLoading(true)
    setError('')
    try {
      const regRef = doc(db, 'matches', matchId, 'registrations', userProfile.uid)
      await runTransaction(db, async (tx) => {
        if ((await tx.get(regRef)).exists()) throw new Error('Already registered.')
        const status = roster.length < match.maxPlayers ? 'confirmed' : 'waitlist'
        tx.set(regRef, {
          uid: userProfile.uid,
          displayName: userProfile.displayName,
          registeredAt: serverTimestamp(),
          status,
          waitlistPosition: status === 'waitlist' ? waitlist.length + 1 : null,
          promotedAt: null,
          confirmDeadline: null,
          team: null,
        })
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '报名失败')
    } finally { setActionLoading(false) }
  }

  const handleWithdraw = async () => {
    if (!userProfile || !matchId) return
    setActionLoading(true)
    setError('')
    try {
      const regRef = doc(db, 'matches', matchId, 'registrations', userProfile.uid)
      await runTransaction(db, async (tx) => {
        if (!(await tx.get(regRef)).exists()) throw new Error('Not registered.')
        tx.update(regRef, { status: 'withdrawn' })
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally { setActionLoading(false) }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!match) return <p className="text-slate">比赛不存在</p>

  const canRegister = !myReg &&
    ['registration_r1', 'registration_r2'].includes(match.status) &&
    (match.status === 'registration_r1' ? userProfile?.membershipStatus === 'active' : true)

  return (
    <div className="space-y-5">
      {/* Match header */}
      <div className="relative rounded-2xl overflow-hidden bg-navy border border-surface">
        <div className="h-1 w-full bg-gradient-to-r from-teal via-teal/50 to-transparent" />
        <div className="p-5">
          <span className="text-[10px] font-black text-teal uppercase tracking-widest block mb-2">
            Match Day
          </span>
          <h1 className="text-white text-2xl font-black tracking-tight leading-tight">
            {match.date?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </h1>
          <p className="text-slate text-sm mt-1">{match.location}</p>
          <span className="inline-block mt-3 text-[10px] font-black text-gold bg-gold/10
                           border border-gold/25 px-3 py-1 rounded-full uppercase tracking-widest capitalize">
            {match.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-hot text-sm bg-red-hot/10 border border-red-hot/20 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      {/* CTA */}
      {canRegister && (
        <button
          onClick={() => setAgreementOpen(true)}
          className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                     py-4 rounded-xl transition-all duration-150 text-base uppercase tracking-wide"
        >
          报名参加 — {roster.length}/{match.maxPlayers} 人
        </button>
      )}

      {/* My registration */}
      {myReg && myReg.status !== 'withdrawn' && (
        <div className="bg-teal/10 border border-teal/30 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-teal font-black text-sm uppercase tracking-wide">{myReg.status}</p>
            {myReg.status === 'waitlist' && (
              <p className="text-slate text-xs mt-0.5">候补位置 #{myReg.waitlistPosition}</p>
            )}
          </div>
          <button
            onClick={handleWithdraw}
            disabled={actionLoading}
            className="text-red-hot hover:text-red-400 text-sm font-bold disabled:opacity-40 transition-colors"
          >
            取消报名
          </button>
        </div>
      )}

      {/* Roster */}
      <section>
        <h2 className="text-[10px] font-black text-slate uppercase tracking-widest mb-3">
          名单 <span className="text-teal">({roster.length}/{match.maxPlayers})</span>
        </h2>
        {roster.length === 0 ? (
          <p className="text-muted text-sm">暂无人报名</p>
        ) : (
          <div className="space-y-2">
            {roster.map((r, i) => (
              <div key={r.uid}
                className="flex items-center gap-3 bg-navy border border-surface rounded-xl px-4 py-3">
                <span className="w-7 text-center text-xs font-black text-muted">{i + 1}</span>
                <span className="flex-1 text-white font-semibold text-sm">{r.displayName || '未命名'}</span>
                {r.team && (
                  <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border
                    ${r.team === 'A'
                      ? 'text-team-a border-team-a/30 bg-team-a/10'
                      : 'text-team-b border-team-b/30 bg-team-b/10'
                    }`}>
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
          <h2 className="text-[10px] font-black text-slate uppercase tracking-widest mb-3">
            候补 ({waitlist.length})
          </h2>
          <div className="space-y-2">
            {waitlist.map((r) => (
              <div key={r.uid}
                className="flex items-center gap-3 bg-navy border border-surface rounded-xl px-4 py-3 opacity-70">
                <span className="w-7 text-center text-xs font-black text-muted">#{r.waitlistPosition}</span>
                <span className="flex-1 text-slate font-semibold text-sm">{r.displayName || '未命名'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Agreement modal */}
      {agreementOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center z-50 p-4">
          <div className="bg-navy-light border border-surface rounded-3xl w-full max-w-sm p-6 space-y-4">
            <div className="w-10 h-1 bg-surface rounded-full mx-auto" />
            <h3 className="font-black text-white text-lg">报名须知</h3>
            <p className="text-slate text-sm leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
              {match.agreementText || '报名即表示您同意遵守队伍规则并出席已报名的比赛。'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setAgreementOpen(false)}
                className="flex-1 border border-surface text-slate font-bold py-3.5 rounded-xl
                           hover:border-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleRegister}
                disabled={actionLoading}
                className="flex-1 bg-teal hover:bg-teal-dark text-pitch font-black py-3.5 rounded-xl
                           transition-colors disabled:opacity-40"
              >
                同意并报名
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
