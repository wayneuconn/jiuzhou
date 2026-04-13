import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  doc, collection, onSnapshot, query, orderBy,
  runTransaction, serverTimestamp, updateDoc, Timestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/authStore'
import type { Match, Registration } from '../types'

const STATUS_LABEL: Record<string, string> = {
  draft:          '草稿',
  registration_r1:'报名 R1',
  registration_r2:'报名 R2',
  drafting:       '选人中',
  ready:          '已就绪',
  completed:      '已结束',
}

function useCountdown(deadline: Date | null | undefined): number | null {
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!deadline) { setTimeLeft(null); return }
    const tick = () => setTimeLeft(Math.max(0, deadline.getTime() - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline])
  return timeLeft
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export default function MatchDetailPage() {
  const { matchId } = useParams<{ matchId: string }>()
  const { userProfile } = useAuthStore()
  const isAdmin = userProfile?.role === 'admin'

  const [match, setMatch]               = useState<Match | null>(null)
  const [registrations, setRegistrations] = useState<Registration[]>([])
  const [loading, setLoading]           = useState(true)
  const [agreementOpen, setAgreementOpen] = useState(false)
  const [waitlistModal, setWaitlistModal] = useState(false)
  const [autoAccept, setAutoAccept]     = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError]               = useState('')
  const [copied, setCopied]             = useState(false)
  const [posFilter, setPosFilter]       = useState<string>('all')
  const autoConfirmRef                  = useRef(false)

  const POS_GROUPS = [
    { key: 'all', label: '全部' },
    { key: 'GK',  label: 'GK',  positions: ['GK'] },
    { key: 'DEF', label: 'DEF', positions: ['CB', 'LB', 'RB'] },
    { key: 'MID', label: 'MID', positions: ['CDM', 'CM', 'CAM'] },
    { key: 'FWD', label: 'FWD', positions: ['LW', 'RW', 'ST'] },
  ]

  const roster = registrations
    .filter((r) => r.status === 'confirmed' || r.status === 'promoted')
    .sort((a, b) => (a.registeredAt?.getTime?.() ?? 0) - (b.registeredAt?.getTime?.() ?? 0))
  const waitlist = registrations
    .filter((r) => r.status === 'waitlist')
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))

  const myReg = registrations.find((r) => r.uid === userProfile?.uid)
  const isFull = !!match && roster.length >= match.maxPlayers
  const isRegistrationOpen = match
    ? ['registration_r1', 'registration_r2'].includes(match.status)
    : false
  const isR1Only  = match?.status === 'registration_r1'
  const r1Ok      = userProfile?.membershipType === 'annual'
  const notYet    = !myReg || myReg.status === 'withdrawn'
  const canRegister  = notYet && isRegistrationOpen && !isFull && (!isR1Only || r1Ok)
  const canWaitlist  = notYet && isRegistrationOpen && isFull && (!isR1Only || r1Ok)

  const promotedDeadline =
    myReg?.status === 'promoted' && myReg.confirmDeadline instanceof Date
      ? myReg.confirmDeadline
      : null
  const timeLeft = useCountdown(promotedDeadline)

  // Real-time match
  useEffect(() => {
    if (!matchId) return
    return onSnapshot(doc(db, 'matches', matchId), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        setMatch({
          id: snap.id, ...d,
          date: d.date?.toDate(),
          createdAt: d.createdAt?.toDate(),
        } as Match)
      }
      setLoading(false)
    })
  }, [matchId])

  // Real-time registrations
  useEffect(() => {
    if (!matchId) return
    return onSnapshot(
      query(collection(db, 'matches', matchId, 'registrations'), orderBy('registeredAt', 'asc')),
      (snap) => setRegistrations(snap.docs.map((d) => {
        const data = d.data()
        return {
          ...data,
          registeredAt:    data.registeredAt?.toDate?.() ?? new Date(),
          promotedAt:      data.promotedAt?.toDate?.() ?? null,
          confirmDeadline: data.confirmDeadline?.toDate?.() ?? null,
        } as Registration
      }))
    )
  }, [matchId])

  // Auto-confirm promoted + autoAccept
  useEffect(() => {
    if (autoConfirmRef.current) return
    if (!myReg || myReg.status !== 'promoted' || !myReg.autoAccept) return
    if (!matchId || !userProfile) return
    const deadline = myReg.confirmDeadline
    if (deadline && deadline.getTime() < Date.now()) return
    autoConfirmRef.current = true
    updateDoc(doc(db, 'matches', matchId, 'registrations', userProfile.uid), {
      status: 'confirmed',
    }).catch(() => { autoConfirmRef.current = false })
  }, [myReg, matchId, userProfile])

  const handleRegister = async (joinWaitlist = false) => {
    if (!match || !userProfile || !matchId) return
    setAgreementOpen(false)
    setWaitlistModal(false)
    setActionLoading(true)
    setError('')
    try {
      const regRef = doc(db, 'matches', matchId, 'registrations', userProfile.uid)
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(regRef)
        if (existing.exists() && existing.data().status !== 'withdrawn') {
          throw new Error('Already registered.')
        }
        const positions = userProfile.preferredPositions ?? []
        if (joinWaitlist) {
          tx.set(regRef, {
            uid: userProfile.uid,
            displayName: userProfile.displayName,
            preferredPositions: positions,
            registeredAt: serverTimestamp(),
            status: 'waitlist',
            waitlistPosition: waitlist.length + 1,
            autoAccept,
            promotedAt: null,
            confirmDeadline: null,
            team: null,
          })
        } else {
          const status = isFull ? 'waitlist' : 'confirmed'
          tx.set(regRef, {
            uid: userProfile.uid,
            displayName: userProfile.displayName,
            preferredPositions: positions,
            registeredAt: serverTimestamp(),
            status,
            waitlistPosition: status === 'waitlist' ? waitlist.length + 1 : null,
            autoAccept: false,
            promotedAt: null,
            confirmDeadline: null,
            team: null,
          })
        }
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
      await updateDoc(doc(db, 'matches', matchId, 'registrations', userProfile.uid), {
        status: 'withdrawn',
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally { setActionLoading(false) }
  }

  const handleConfirmSpot = async () => {
    if (!userProfile || !matchId) return
    setActionLoading(true)
    setError('')
    try {
      await updateDoc(doc(db, 'matches', matchId, 'registrations', userProfile.uid), {
        status: 'confirmed',
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally { setActionLoading(false) }
  }

  const handlePromote = async (uid: string) => {
    if (!matchId) return
    setActionLoading(true)
    setError('')
    try {
      const deadline = Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000))
      await updateDoc(doc(db, 'matches', matchId, 'registrations', uid), {
        status: 'promoted',
        promotedAt: serverTimestamp(),
        confirmDeadline: deadline,
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally { setActionLoading(false) }
  }

  const handleSetCaptain = async (slot: 'captainA' | 'captainB', uid: string | null) => {
    if (!matchId) return
    try {
      await updateDoc(doc(db, 'matches', matchId), { [slot]: uid ?? null })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '设置失败')
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/match/${matchId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!match) return <p className="text-slate">比赛不存在</p>

  const showShareLink = match.status !== 'draft'
  const captainAName  = registrations.find((r) => r.uid === match.captainA)?.displayName
  const captainBName  = registrations.find((r) => r.uid === match.captainB)?.displayName

  return (
    <div className="space-y-5">
      {/* Match header */}
      <div className="relative rounded-2xl overflow-hidden bg-navy border border-surface">
        <div className="h-1 w-full bg-gradient-to-r from-teal via-teal/50 to-transparent" />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-black text-teal uppercase tracking-widest block mb-2">
                Match Day
              </span>
              <h1 className="text-white text-2xl font-black tracking-tight leading-tight">
                {match.date?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </h1>
              <p className="text-slate text-sm mt-1">{match.location}</p>
            </div>
            {showShareLink && (
              <button
                onClick={handleCopyLink}
                className="shrink-0 text-[10px] font-black text-teal bg-teal/10 border border-teal/25
                           px-3 py-2 rounded-xl hover:bg-teal/20 transition-colors"
              >
                {copied ? '✓ 已复制' : '分享'}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className="text-[10px] font-black text-gold bg-gold/10 border border-gold/25
                             px-3 py-1 rounded-full uppercase tracking-widest">
              {STATUS_LABEL[match.status] ?? match.status}
            </span>
            {match.captainA && (
              <span className="text-[10px] font-black text-team-a bg-team-a/10 border border-team-a/25
                               px-3 py-1 rounded-full">
                队长A: {captainAName ?? '—'}
              </span>
            )}
            {match.captainB && (
              <span className="text-[10px] font-black text-team-b bg-team-b/10 border border-team-b/25
                               px-3 py-1 rounded-full">
                队长B: {captainBName ?? '—'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-hot text-sm bg-red-hot/10 border border-red-hot/20 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      {/* My status: Promoted */}
      {myReg?.status === 'promoted' && (
        <div className="bg-gold/10 border border-gold/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gold font-black text-sm uppercase tracking-wide">有名额！</p>
              <p className="text-slate text-xs mt-0.5">
                {timeLeft !== null && timeLeft > 0
                  ? `请在 ${fmtTime(timeLeft)} 内确认`
                  : '确认窗口已过期'}
              </p>
            </div>
            {timeLeft !== null && timeLeft > 0 && (
              <span className="text-gold font-black text-xl tabular-nums">{fmtTime(timeLeft)}</span>
            )}
          </div>
          {timeLeft !== null && timeLeft > 0 && (
            <div className="flex gap-3">
              <button
                onClick={handleWithdraw}
                disabled={actionLoading}
                className="flex-1 border border-surface text-slate font-bold py-3 rounded-xl
                           hover:border-muted transition-colors disabled:opacity-40 text-sm"
              >
                放弃
              </button>
              <button
                onClick={handleConfirmSpot}
                disabled={actionLoading}
                className="flex-1 bg-gold text-pitch font-black py-3 rounded-xl
                           transition-colors disabled:opacity-40 text-sm"
              >
                确认参加
              </button>
            </div>
          )}
        </div>
      )}

      {/* My status: Waitlist */}
      {myReg?.status === 'waitlist' && (
        <div className="bg-surface/50 border border-surface rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-white font-black text-sm">候补中</p>
            <p className="text-slate text-xs mt-0.5">
              位置 #{myReg.waitlistPosition}
              {myReg.autoAccept && <span className="text-teal"> · 自动接受</span>}
            </p>
          </div>
          <button
            onClick={handleWithdraw}
            disabled={actionLoading}
            className="text-red-hot text-sm font-bold disabled:opacity-40 transition-colors"
          >
            退出
          </button>
        </div>
      )}

      {/* My status: Confirmed */}
      {myReg?.status === 'confirmed' && (
        <div className="bg-teal/10 border border-teal/30 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-teal font-black text-sm uppercase tracking-wide">已确认报名</p>
            {myReg.team && (
              <p className="text-slate text-xs mt-0.5">Team {myReg.team}</p>
            )}
          </div>
          {isRegistrationOpen && (
            <button
              onClick={handleWithdraw}
              disabled={actionLoading}
              className="text-red-hot text-sm font-bold disabled:opacity-40 transition-colors"
            >
              取消报名
            </button>
          )}
        </div>
      )}

      {/* CTA: Register */}
      {canRegister && (
        <button
          onClick={() => setAgreementOpen(true)}
          disabled={actionLoading}
          className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                     py-4 rounded-xl transition-all duration-150 text-base uppercase tracking-wide
                     disabled:opacity-40"
        >
          报名参加 — {roster.length}/{match.maxPlayers} 人
        </button>
      )}

      {/* CTA: Waitlist */}
      {canWaitlist && (
        <button
          onClick={() => setWaitlistModal(true)}
          disabled={actionLoading}
          className="w-full bg-surface border border-surface hover:border-muted active:scale-95
                     text-white font-black py-4 rounded-xl transition-all duration-150 text-base
                     uppercase tracking-wide disabled:opacity-40"
        >
          加入候补 — 满员 ({roster.length}/{match.maxPlayers})
        </button>
      )}

      {/* R1 not eligible */}
      {notYet && isR1Only && !r1Ok && (
        <div className="bg-surface/30 border border-surface rounded-xl p-4 text-center">
          <p className="text-slate text-sm">R1 报名阶段仅限年卡会员</p>
          <p className="text-muted text-xs mt-1">等待 R2 开启后即可报名</p>
        </div>
      )}

      {/* Roster */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[10px] font-black text-slate uppercase tracking-widest">
            名单 <span className="text-teal">({roster.length}/{match.maxPlayers})</span>
          </h2>
        </div>

        {/* Position filter — only shown when there are positions to filter */}
        {roster.some((r) => (r.preferredPositions ?? []).length > 0) && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3 scrollbar-none">
            {POS_GROUPS.map((g) => (
              <button
                key={g.key}
                onClick={() => setPosFilter(g.key)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all
                  ${posFilter === g.key
                    ? 'bg-teal border-teal text-pitch'
                    : 'border-surface text-slate hover:border-muted hover:text-white'}`}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}

        {roster.length === 0 ? (
          <p className="text-muted text-sm">暂无人报名</p>
        ) : (() => {
          const group = POS_GROUPS.find((g) => g.key === posFilter)
          const filtered = posFilter === 'all'
            ? roster
            : roster.filter((r) => {
                const first = (r.preferredPositions ?? [])[0]
                return first && group?.positions?.includes(first)
              })
          return (
            <div className="space-y-2">
              {filtered.length === 0 && (
                <p className="text-muted text-sm">该位置暂无人报名</p>
              )}
              {filtered.map((r, i) => {
                const globalIndex = roster.indexOf(r)
                const positions = r.preferredPositions ?? []
                return (
                  <div key={r.uid}
                    className="flex items-center gap-3 bg-navy border border-surface rounded-xl px-4 py-3">
                    <span className="w-7 text-center text-xs font-black text-muted">
                      {posFilter === 'all' ? i + 1 : globalIndex + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm truncate">
                        {r.displayName || '未命名'}
                      </p>
                      {positions.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {positions.map((pos, pi) => (
                            <span key={pos}
                              className={`text-[9px] font-black px-1.5 py-px rounded border
                                ${pi === 0
                                  ? 'text-teal border-teal/40 bg-teal/10'
                                  : 'text-muted border-surface'}`}>
                              {pos}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {r.uid === match.captainA && (
                      <span className="text-[10px] font-black text-team-a border border-team-a/30
                                       bg-team-a/10 px-2 py-0.5 rounded-full shrink-0">队长A</span>
                    )}
                    {r.uid === match.captainB && (
                      <span className="text-[10px] font-black text-team-b border border-team-b/30
                                       bg-team-b/10 px-2 py-0.5 rounded-full shrink-0">队长B</span>
                    )}
                    {r.team && r.uid !== match.captainA && r.uid !== match.captainB && (
                      <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full border shrink-0
                        ${r.team === 'A'
                          ? 'text-team-a border-team-a/30 bg-team-a/10'
                          : 'text-team-b border-team-b/30 bg-team-b/10'}`}>
                        {r.team}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </section>

      {/* Waitlist section */}
      {waitlist.length > 0 && (
        <section>
          <h2 className="text-[10px] font-black text-slate uppercase tracking-widest mb-3">
            候补 ({waitlist.length})
          </h2>
          <div className="space-y-2">
            {waitlist.map((r) => (
              <div key={r.uid}
                className="flex items-center gap-3 bg-navy border border-surface rounded-xl px-4 py-3">
                <span className="w-7 text-center text-xs font-black text-muted">#{r.waitlistPosition}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-slate font-semibold text-sm">{r.displayName || '未命名'}</span>
                  {r.autoAccept && (
                    <span className="ml-2 text-[10px] text-teal/70 font-bold">自动</span>
                  )}
                </div>
                {isAdmin && roster.length < match.maxPlayers && (
                  <button
                    onClick={() => handlePromote(r.uid)}
                    disabled={actionLoading}
                    className="text-teal text-xs font-black border border-teal/25 px-2.5 py-1
                               rounded-lg hover:bg-teal/10 transition-colors disabled:opacity-30"
                  >
                    晋升
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Admin: Captain controls */}
      {isAdmin && (
        <section className="bg-navy border border-surface rounded-2xl p-4 space-y-4">
          <p className="text-[10px] font-black text-slate uppercase tracking-widest">
            管理员 · 队长设置
          </p>
          {(['captainA', 'captainB'] as const).map((slot) => (
            <div key={slot}>
              <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">
                {slot === 'captainA' ? '队长 A' : '队长 B'}
              </label>
              <select
                value={match[slot] ?? ''}
                onChange={(e) => handleSetCaptain(slot, e.target.value || null)}
                className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                           px-4 py-3 text-white text-sm focus:outline-none transition-colors"
              >
                <option value="">— 暂未设置 —</option>
                {roster.map((r) => (
                  <option key={r.uid} value={r.uid}>{r.displayName}</option>
                ))}
              </select>
            </div>
          ))}
        </section>
      )}

      {/* Agreement modal (for regular sign-up) */}
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
                onClick={() => handleRegister(false)}
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

      {/* Waitlist modal */}
      {waitlistModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center z-50 p-4">
          <div className="bg-navy-light border border-surface rounded-3xl w-full max-w-sm p-6 space-y-4">
            <div className="w-10 h-1 bg-surface rounded-full mx-auto" />
            <h3 className="font-black text-white text-lg">加入候补</h3>
            <p className="text-slate text-sm leading-relaxed">
              名额已满，你将排在候补位置 <span className="text-white font-bold">#{waitlist.length + 1}</span>。
              有人退出时按顺序晋升。
            </p>

            {/* Auto-accept toggle */}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button
                role="switch"
                aria-checked={autoAccept}
                onClick={() => setAutoAccept((v) => !v)}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0
                  ${autoAccept ? 'bg-teal' : 'bg-surface'}`}
              >
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow
                  transition-transform ${autoAccept ? 'translate-x-6' : 'translate-x-0.5'}`} />
              </button>
              <div>
                <p className="text-white text-sm font-bold">自动接受晋升</p>
                <p className="text-muted text-xs">晋升时直接确认，无需手动操作</p>
              </div>
            </label>

            {!autoAccept && (
              <p className="text-muted text-xs bg-surface/60 rounded-xl p-3 leading-relaxed">
                晋升后有 30 分钟确认窗口，超时将跳过至下一位候补。
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setWaitlistModal(false)}
                className="flex-1 border border-surface text-slate font-bold py-3.5 rounded-xl
                           hover:border-muted transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleRegister(true)}
                disabled={actionLoading}
                className="flex-1 bg-teal hover:bg-teal-dark text-pitch font-black py-3.5 rounded-xl
                           transition-colors disabled:opacity-40"
              >
                确认候补
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
