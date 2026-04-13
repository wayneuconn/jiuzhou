import { useEffect, useState, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import {
  doc, collection, onSnapshot, getDoc,
  runTransaction, serverTimestamp, updateDoc, Timestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuthStore } from '../stores/authStore'
import { Pitch } from '../components/Pitch'
import type { PitchPlayer } from '../components/Pitch'
import type { Match, Registration } from '../types'
import Markdown from '../components/Markdown'

const STATUS_LABEL: Record<string, string> = {
  draft:           '草稿',
  registration_r1: '报名 R1',
  registration_r2: '报名 R2',
  drafting:        '选人中',
  ready:           '已就绪',
  completed:       '已结束',
  cancelled:       '已取消',
}

function useCountdown(deadline: Date | null | undefined): number | null {
  const [ms, setMs] = useState<number | null>(null)
  useEffect(() => {
    if (!deadline) { setMs(null); return }
    const tick = () => setMs(Math.max(0, deadline.getTime() - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline])
  return ms
}

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const POS_GROUPS = [
  { key: 'all', label: '全部' },
  { key: 'GK',  label: 'GK',  positions: ['GK'] },
  { key: 'DEF', label: 'DEF', positions: ['CB', 'LB', 'RB'] },
  { key: 'MID', label: 'MID', positions: ['CDM', 'CM', 'CAM'] },
  { key: 'FWD', label: 'FWD', positions: ['LW', 'RW', 'ST'] },
]

export default function MatchDetailPage() {
  const { matchId } = useParams<{ matchId: string }>()
  const { userProfile } = useAuthStore()
  const isAdmin = userProfile?.role === 'admin'

  const [match, setMatch]             = useState<Match | null>(null)
  const [regs, setRegs]               = useState<Registration[]>([])
  const [matchLoaded, setMatchLoaded] = useState(false)
  const [regsLoaded, setRegsLoaded]   = useState(false)

  const [agreementOpen, setAgreementOpen] = useState(false)
  const [waitlistModal, setWaitlistModal] = useState(false)
  const [venmoModal, setVenmoModal]       = useState(false)
  const [autoAccept, setAutoAccept]       = useState(true)
  const [defaultAgreement, setDefaultAgreement]   = useState('')
  const [defaultVenmoHandle, setDefaultVenmoHandle] = useState('')
  const [perSessionFee, setPerSessionFee]           = useState(2)
  const [busy, setBusy]                   = useState(false)
  const [error, setError]                 = useState('')
  const [copied, setCopied]               = useState(false)
  const [posFilter, setPosFilter]         = useState('all')
  const autoConfirmRef                    = useRef(false)

  // ── Derived lists ────────────────────────────────────────────────────
  const roster = regs
    .filter((r) => r.status === 'confirmed' || r.status === 'promoted')
    .sort((a, b) => (a.registeredAt?.getTime?.() ?? 0) - (b.registeredAt?.getTime?.() ?? 0))
  const waitlist = regs
    .filter((r) => r.status === 'waitlist')
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0))
  const excusedList = regs.filter((r) => r.status === 'excused')

  const myReg       = regs.find((r) => r.uid === userProfile?.uid)
  const isFull      = !!match && roster.length >= match.maxPlayers
  const isOpen      = match ? ['registration_r1', 'registration_r2'].includes(match.status) : false
  const isR1        = match?.status === 'registration_r1'
  const r1Ok        = isAdmin || userProfile?.membershipType === 'annual'
  const isCaptainA  = !!match?.captainA && userProfile?.uid === match.captainA
  const isCaptainB  = !!match?.captainB && userProfile?.uid === match.captainB
  const isAnyCaptain = isCaptainA || isCaptainB

  const notRegistered = !myReg || myReg.status === 'withdrawn' || myReg.status === 'excused'
  const canRegister   = notRegistered && isOpen && !isFull && (!isR1 || r1Ok)
  const canWaitlist   = notRegistered && isOpen && isFull  && (!isR1 || r1Ok)
  const r1Blocked     = notRegistered && isR1 && !r1Ok

  const promotedDeadline = myReg?.status === 'promoted' && myReg.confirmDeadline instanceof Date
    ? myReg.confirmDeadline : null
  const timeLeft = useCountdown(promotedDeadline)

  // Team player lists
  const teamAPlayers: PitchPlayer[] = roster
    .filter((r) => r.team === 'A')
    .map((r) => ({ uid: r.uid, displayName: r.displayName, preferredPositions: r.preferredPositions ?? [] }))
  const teamBPlayers: PitchPlayer[] = roster
    .filter((r) => r.team === 'B')
    .map((r) => ({ uid: r.uid, displayName: r.displayName, preferredPositions: r.preferredPositions ?? [] }))
  const unassignedRoster = roster.filter((r) => !r.team)

  // Draft/tactics visibility
  const isDraftPhase   = match?.status === 'drafting'
  const showDraft      = (isAdmin || isAnyCaptain) && isDraftPhase && !!match?.captainA && !!match?.captainB
  const canSeeTeamA    = isCaptainA || myReg?.team === 'A'
  const canSeeTeamB    = isCaptainB || myReg?.team === 'B'
  const hasTactics     = !!match?.captainA || !!match?.captainB
  const tacticPhase    = match ? ['drafting', 'ready'].includes(match.status) : false

  // Stable Firestore refs for formations
  const formationARef = useMemo(
    () => matchId ? doc(db, 'matches', matchId, 'formations', 'teamA') : null,
    [matchId],
  )
  const formationBRef = useMemo(
    () => matchId ? doc(db, 'matches', matchId, 'formations', 'teamB') : null,
    [matchId],
  )

  // ── Real-time listeners ──────────────────────────────────────────────
  useEffect(() => {
    if (!matchId) return
    return onSnapshot(doc(db, 'matches', matchId), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        setMatch({ id: snap.id, ...d, date: d.date?.toDate(), createdAt: d.createdAt?.toDate() } as Match)
      }
      setMatchLoaded(true)
    })
  }, [matchId])

  useEffect(() => {
    if (!matchId) return
    // No orderBy — sort client-side to avoid composite-index requirement
    return onSnapshot(collection(db, 'matches', matchId, 'registrations'), (snap) => {
      setRegs(snap.docs.map((d) => {
        const data = d.data()
        return {
          ...data,
          registeredAt:    data.registeredAt?.toDate?.()    ?? new Date(),
          promotedAt:      data.promotedAt?.toDate?.()      ?? null,
          confirmDeadline: data.confirmDeadline?.toDate?.() ?? null,
        } as Registration
      }))
      setRegsLoaded(true)
    })
  }, [matchId])

  // Load config
  useEffect(() => {
    getDoc(doc(db, 'config', 'appConfig')).then((snap) => {
      if (snap.exists()) {
        setDefaultAgreement(snap.data().defaultAgreementText ?? '')
        setDefaultVenmoHandle(snap.data().defaultVenmoHandle ?? '')
        setPerSessionFee(snap.data().perSessionFee ?? 2)
      }
    })
  }, [])

  // Auto-confirm if promoted + autoAccept flag
  useEffect(() => {
    if (autoConfirmRef.current) return
    if (!myReg || myReg.status !== 'promoted' || !myReg.autoAccept) return
    if (!matchId || !userProfile) return
    const dl = myReg.confirmDeadline
    if (dl && dl.getTime() < Date.now()) return
    autoConfirmRef.current = true
    updateDoc(doc(db, 'matches', matchId, 'registrations', userProfile.uid), {
      status: 'confirmed',
    }).catch(() => { autoConfirmRef.current = false })
  }, [myReg, matchId, userProfile])

  // ── Action handlers ──────────────────────────────────────────────────
  const doRegister = async (joinWaitlist = false) => {
    if (!match || !userProfile || !matchId) return
    setAgreementOpen(false)
    setWaitlistModal(false)
    setBusy(true); setError('')
    try {
      const regRef = doc(db, 'matches', matchId, 'registrations', userProfile.uid)
      await runTransaction(db, async (tx) => {
        const ex = await tx.get(regRef)
        if (ex.exists() && !['withdrawn', 'excused'].includes(ex.data().status)) throw new Error('Already registered')
        const positions = userProfile.preferredPositions ?? []
        const isPerSession = userProfile.membershipType === 'per_session'
        if (joinWaitlist) {
          tx.set(regRef, {
            uid: userProfile.uid, displayName: userProfile.displayName,
            preferredPositions: positions,
            registeredAt: serverTimestamp(),
            status: 'waitlist', waitlistPosition: waitlist.length + 1,
            autoAccept, promotedAt: null, confirmDeadline: null, team: null,
            paymentStatus: null,
          })
        } else {
          tx.set(regRef, {
            uid: userProfile.uid, displayName: userProfile.displayName,
            preferredPositions: positions,
            registeredAt: serverTimestamp(),
            status: 'confirmed', waitlistPosition: null,
            autoAccept: false, promotedAt: null, confirmDeadline: null, team: null,
            paymentStatus: isPerSession ? 'pending' : null,
          })
        }
      })
      if (userProfile.membershipType === 'per_session' && !joinWaitlist) {
        setVenmoModal(true)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '报名失败，请重试')
    } finally { setBusy(false) }
  }

  const doExcuse = async () => {
    if (!userProfile || !matchId) return
    setBusy(true); setError('')
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'matches', matchId, 'registrations', userProfile.uid), {
        status: 'excused',
      })
      if (waitlist.length > 0) {
        const next = waitlist[0]
        if (next.autoAccept) {
          batch.update(doc(db, 'matches', matchId, 'registrations', next.uid), {
            status: 'confirmed',
            promotedAt: serverTimestamp(),
            confirmDeadline: null,
          })
        } else {
          batch.update(doc(db, 'matches', matchId, 'registrations', next.uid), {
            status: 'promoted',
            promotedAt: serverTimestamp(),
            confirmDeadline: Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000)),
          })
        }
      }
      await batch.commit()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '操作失败') }
    finally { setBusy(false) }
  }

  const doWithdraw = async () => {
    if (!userProfile || !matchId) return
    setBusy(true); setError('')
    try {
      // When a confirmed/promoted player withdraws, auto-promote the next waitlist person
      const hadSpot = myReg?.status === 'confirmed' || myReg?.status === 'promoted'
      const batch = writeBatch(db)

      batch.update(doc(db, 'matches', matchId, 'registrations', userProfile.uid), {
        status: 'withdrawn',
      })

      if (hadSpot && waitlist.length > 0) {
        const next = waitlist[0]
        if (next.autoAccept) {
          batch.update(doc(db, 'matches', matchId, 'registrations', next.uid), {
            status: 'confirmed',
            promotedAt: serverTimestamp(),
            confirmDeadline: null,
          })
        } else {
          batch.update(doc(db, 'matches', matchId, 'registrations', next.uid), {
            status: 'promoted',
            promotedAt: serverTimestamp(),
            confirmDeadline: Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000)),
          })
        }
      }

      await batch.commit()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '操作失败') }
    finally { setBusy(false) }
  }

  const doConfirmSpot = async () => {
    if (!userProfile || !matchId) return
    setBusy(true); setError('')
    try {
      await updateDoc(doc(db, 'matches', matchId, 'registrations', userProfile.uid), { status: 'confirmed' })
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '操作失败') }
    finally { setBusy(false) }
  }

  const doSetCaptain = async (slot: 'captainA' | 'captainB', uid: string | null) => {
    if (!matchId) return
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'matches', matchId), { [slot]: uid ?? null })
      if (uid) {
        // Automatically assign captain to their team
        const team = slot === 'captainA' ? 'A' : 'B'
        batch.update(doc(db, 'matches', matchId, 'registrations', uid), { team })
      }
      await batch.commit()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '设置失败') }
  }

  const doAssignTeam = async (uid: string, team: 'A' | 'B' | null) => {
    if (!matchId) return
    setBusy(true); setError('')
    try {
      await updateDoc(doc(db, 'matches', matchId, 'registrations', uid), { team })
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '操作失败') }
    finally { setBusy(false) }
  }

  const doConfirmPayment = async (uid: string) => {
    if (!matchId) return
    try {
      await updateDoc(doc(db, 'matches', matchId, 'registrations', uid), { paymentStatus: 'confirmed' })
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '操作失败') }
  }

  // ── Render ───────────────────────────────────────────────────────────
  if (!matchLoaded) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!match) return <p className="text-slate py-8 text-center">比赛不存在</p>

  const captainAName = regs.find((r) => r.uid === match.captainA)?.displayName
  const captainBName = regs.find((r) => r.uid === match.captainB)?.displayName

  return (
    <div className="space-y-4">

      {/* ── Match header ── */}
      <div className="relative rounded-2xl overflow-hidden bg-navy border border-surface">
        <div className="h-1 w-full bg-gradient-to-r from-teal via-teal/50 to-transparent" />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-black text-teal uppercase tracking-widest block mb-1.5">
                Match Day
              </span>
              <h1 className="text-white text-xl font-black tracking-tight leading-snug">
                {match.date?.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
                <span className="text-slate text-sm font-normal ml-2">
                  {match.date?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </h1>
              <p className="text-slate text-sm mt-1">{match.location}</p>
            </div>
            {match.status !== 'draft' && (
              <button onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/match/${matchId}`)
                setCopied(true); setTimeout(() => setCopied(false), 2000)
              }}
                className="shrink-0 text-[10px] font-black text-teal bg-teal/10 border border-teal/25
                           px-3 py-2 rounded-xl hover:bg-teal/20 transition-colors"
              >
                {copied ? '✓ 已复制' : '分享'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <span className="text-[10px] font-black text-gold bg-gold/10 border border-gold/25
                             px-3 py-1 rounded-full uppercase tracking-widest">
              {STATUS_LABEL[match.status]}
            </span>
            {match.captainA && (
              <span className="text-[10px] font-black text-team-a bg-team-a/10 border border-team-a/25
                               px-2.5 py-1 rounded-full">
                队长A · {captainAName ?? '—'}
              </span>
            )}
            {match.captainB && (
              <span className="text-[10px] font-black text-team-b bg-team-b/10 border border-team-b/25
                               px-2.5 py-1 rounded-full">
                队长B · {captainBName ?? '—'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Action card ── */}
      {match.status === 'cancelled' ? (
        <div className="bg-red-hot/10 border border-red-hot/30 rounded-2xl p-4 text-center">
          <p className="text-red-hot font-black text-sm">比赛已取消</p>
          <p className="text-slate text-xs mt-1">本场比赛已被取消，请关注后续通知</p>
        </div>
      ) : !regsLoaded || !userProfile ? (
        <div className="h-16 rounded-2xl bg-navy border border-surface animate-pulse" />
      ) : myReg?.status === 'promoted' ? (
        <div className="bg-gold/10 border border-gold/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gold font-black text-sm uppercase tracking-wide">有名额等你！</p>
              <p className="text-slate text-xs mt-0.5">
                {timeLeft !== null && timeLeft > 0
                  ? `请在 ${fmtTime(timeLeft)} 内确认，否则自动跳过`
                  : '确认窗口已过期'}
              </p>
            </div>
            {timeLeft !== null && timeLeft > 0 && (
              <span className="text-gold font-black text-2xl tabular-nums">{fmtTime(timeLeft)}</span>
            )}
          </div>
          {timeLeft !== null && timeLeft > 0 && (
            <div className="flex gap-3">
              <button onClick={doWithdraw} disabled={busy}
                className="flex-1 border border-surface text-slate font-bold py-3 rounded-xl
                           hover:border-muted transition-colors disabled:opacity-40 text-sm">
                放弃
              </button>
              <button onClick={doConfirmSpot} disabled={busy}
                className="flex-1 bg-gold text-pitch font-black py-3 rounded-xl disabled:opacity-40 text-sm">
                报名
              </button>
            </div>
          )}
        </div>
      ) : myReg?.status === 'confirmed' ? (
        <div className="bg-teal/10 border border-teal/30 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-teal font-black text-sm uppercase tracking-wide">已报名</p>
              <p className="text-slate text-xs mt-0.5">
                第 {roster.findIndex((r) => r.uid === userProfile?.uid) + 1} 位
                {myReg.team && ` · Team ${myReg.team}`}
              </p>
            </div>
            {isOpen && !isAnyCaptain && (
              <button onClick={doExcuse} disabled={busy}
                className="text-slate text-sm font-bold disabled:opacity-40 transition-colors hover:text-white">
                请假
              </button>
            )}
          </div>
          {myReg.paymentStatus === 'pending' && defaultVenmoHandle && (
            <div className="flex items-center justify-between bg-gold/10 border border-gold/25 rounded-xl px-3 py-2">
              <div>
                <p className="text-gold text-xs font-black">待付款 · ${perSessionFee}</p>
                <p className="text-muted text-[10px] mt-0.5">@{defaultVenmoHandle}</p>
              </div>
              <a href={`https://venmo.com/${defaultVenmoHandle}?txn=pay&amount=${perSessionFee}&note=${encodeURIComponent('Match Fee')}`}
                target="_blank" rel="noopener noreferrer"
                className="text-gold text-xs font-black border border-gold/30 px-3 py-1.5 rounded-lg
                           hover:bg-gold/10 transition-colors">
                去支付
              </a>
            </div>
          )}
          {myReg.paymentStatus === 'confirmed' && (
            <p className="text-teal text-xs font-bold">✓ 已付款</p>
          )}
        </div>
      ) : myReg?.status === 'excused' ? (
        <div className="bg-surface/50 border border-surface rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-white font-black text-sm">已请假</p>
            <p className="text-slate text-xs mt-0.5">可随时重新报名</p>
          </div>
          {isOpen && (
            canRegister ? (
              <button onClick={() => setAgreementOpen(true)} disabled={busy}
                className="text-teal text-sm font-bold disabled:opacity-40 transition-colors hover:text-teal-dark">
                重新报名
              </button>
            ) : canWaitlist ? (
              <button onClick={() => setWaitlistModal(true)} disabled={busy}
                className="text-teal text-sm font-bold disabled:opacity-40 transition-colors hover:text-teal-dark">
                加入 Waitlist
              </button>
            ) : null
          )}
        </div>
      ) : myReg?.status === 'waitlist' ? (
        <div className="bg-surface/50 border border-surface rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-white font-black text-sm">Waitlist</p>
            <p className="text-slate text-xs mt-0.5">
              #{myReg.waitlistPosition}
              {myReg.autoAccept && <span className="text-teal"> · 自动接受</span>}
            </p>
          </div>
          <button onClick={doWithdraw} disabled={busy}
            className="text-red-hot text-sm font-bold disabled:opacity-40 transition-colors">
            退出
          </button>
        </div>
      ) : canRegister ? (
        <button onClick={() => setAgreementOpen(true)} disabled={busy}
          className="w-full bg-teal hover:bg-teal-dark active:scale-[0.98] text-pitch font-black
                     py-4 rounded-2xl transition-all duration-150 text-base disabled:opacity-40">
          报名参加 — 还剩 {match.maxPlayers - roster.length} 个名额
        </button>
      ) : canWaitlist ? (
        <button onClick={() => setWaitlistModal(true)} disabled={busy}
          className="w-full border border-teal/40 text-teal hover:bg-teal/10 active:scale-[0.98]
                     font-black py-4 rounded-2xl transition-all duration-150 text-base disabled:opacity-40">
          加入 Waitlist — 名额已满 ({roster.length}/{match.maxPlayers})
        </button>
      ) : r1Blocked ? (
        <div className="bg-surface/30 border border-surface rounded-2xl p-4 text-center">
          <p className="text-slate text-sm font-bold">R1 阶段仅限年卡会员报名</p>
          <p className="text-muted text-xs mt-1">R2 开放后所有成员均可报名</p>
        </div>
      ) : isOpen ? null : (
        <div className="bg-surface/30 border border-surface rounded-2xl p-4 text-center">
          <p className="text-slate text-sm">报名已关闭</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-red-hot text-sm bg-red-hot/10 border border-red-hot/20 px-3 py-2 rounded-xl">
          {error}
        </p>
      )}

      {/* ── Roster ── */}
      <section>
        <h2 className="text-[10px] font-black text-slate uppercase tracking-widest mb-3">
          名单 <span className="text-teal">({roster.length}/{match.maxPlayers})</span>
        </h2>

        {roster.some((r) => (r.preferredPositions ?? []).length > 0) && (
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
            {POS_GROUPS.map((g) => (
              <button key={g.key} onClick={() => setPosFilter(g.key)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all
                  ${posFilter === g.key
                    ? 'bg-teal border-teal text-pitch'
                    : 'border-surface text-slate hover:border-muted hover:text-white'}`}>
                {g.label}
              </button>
            ))}
          </div>
        )}

        {roster.length === 0 ? (
          <p className="text-muted text-sm">暂无人报名</p>
        ) : (() => {
          const grp  = POS_GROUPS.find((g) => g.key === posFilter)
          const shown = posFilter === 'all' ? roster
            : roster.filter((r) => {
                const first = (r.preferredPositions ?? [])[0]
                return first && grp?.positions?.includes(first)
              })
          return (
            <div className="space-y-2">
              {shown.length === 0 && <p className="text-muted text-sm">该位置暂无人</p>}
              {shown.map((r, i) => (
                <div key={r.uid}
                  className="flex items-center gap-3 bg-navy border border-surface rounded-xl px-4 py-3">
                  <span className="w-6 text-center text-xs font-black text-muted shrink-0">
                    {posFilter === 'all' ? i + 1 : roster.indexOf(r) + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{r.displayName || '未命名'}</p>
                    {(r.preferredPositions ?? []).length > 0 && (
                      <div className="flex gap-1 mt-0.5">
                        {(r.preferredPositions ?? []).map((pos, pi) => (
                          <span key={pos}
                            className={`text-[9px] font-black px-1.5 py-px rounded border
                              ${pi === 0 ? 'text-teal border-teal/40 bg-teal/10' : 'text-muted border-surface'}`}>
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
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border shrink-0
                      ${r.team === 'A' ? 'text-team-a border-team-a/30 bg-team-a/10'
                                       : 'text-team-b border-team-b/30 bg-team-b/10'}`}>
                      {r.team}
                    </span>
                  )}
                  {r.paymentStatus === 'pending' && (
                    isAdmin ? (
                      <button onClick={() => doConfirmPayment(r.uid)}
                        className="text-[10px] font-black text-gold border border-gold/30 bg-gold/10
                                   px-2 py-0.5 rounded-full shrink-0 hover:bg-gold/20 transition-colors">
                        待付款
                      </button>
                    ) : (
                      <span className="text-[10px] font-black text-gold border border-gold/30 bg-gold/10
                                       px-2 py-0.5 rounded-full shrink-0">待付款</span>
                    )
                  )}
                  {r.paymentStatus === 'confirmed' && (
                    <span className="text-[10px] font-black text-teal border border-teal/30 bg-teal/10
                                     px-2 py-0.5 rounded-full shrink-0">已付款</span>
                  )}
                </div>
              ))}
            </div>
          )
        })()}
      </section>

      {/* ── Waitlist ── */}
      {waitlist.length > 0 && (
        <section>
          <h2 className="text-[10px] font-black text-slate uppercase tracking-widest mb-3">
            Waitlist ({waitlist.length})
          </h2>
          <div className="space-y-2">
            {waitlist.map((r) => (
              <div key={r.uid}
                className="flex items-center gap-3 bg-navy border border-surface rounded-xl px-4 py-3">
                <span className="w-6 text-center text-xs font-black text-muted shrink-0">
                  #{r.waitlistPosition}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-slate font-semibold text-sm truncate">{r.displayName || '未命名'}</p>
                  {r.autoAccept && <p className="text-[10px] text-teal/70 font-bold mt-0.5">自动接受</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Excused ── */}
      {excusedList.length > 0 && (
        <section>
          <h2 className="text-[10px] font-black text-slate uppercase tracking-widest mb-3">
            请假 ({excusedList.length})
          </h2>
          <div className="space-y-2">
            {excusedList.map((r) => (
              <div key={r.uid}
                className="flex items-center gap-3 bg-navy border border-surface rounded-xl px-4 py-3 opacity-60">
                <div className="flex-1 min-w-0">
                  <p className="text-slate font-semibold text-sm truncate">{r.displayName || '未命名'}</p>
                </div>
                <span className="text-[10px] font-black text-muted shrink-0">请假</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Admin: captain dropdowns ── */}
      {isAdmin && roster.length > 0 && (
        <section className="bg-navy border border-surface rounded-2xl p-4 space-y-3">
          <p className="text-[10px] font-black text-slate uppercase tracking-widest">队长设置</p>
          {(['captainA', 'captainB'] as const).map((slot) => (
            <div key={slot}>
              <label className="text-[10px] text-muted block mb-1.5">
                {slot === 'captainA' ? '队长 A' : '队长 B'}
              </label>
              <select value={match[slot] ?? ''}
                onChange={(e) => doSetCaptain(slot, e.target.value || null)}
                className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                           px-4 py-3 text-white text-sm focus:outline-none transition-colors">
                <option value="">— 未设置 —</option>
                {roster.map((r) => (
                  <option key={r.uid} value={r.uid}>{r.displayName}</option>
                ))}
              </select>
            </div>
          ))}
        </section>
      )}

      {/* ── Draft: captain picks players ── */}
      {showDraft && (
        <section className="space-y-3">
          <h2 className="text-[10px] font-black text-slate uppercase tracking-widest">选人</h2>

          {/* Unassigned pool */}
          {unassignedRoster.length > 0 ? (
            <div className="space-y-2">
              <p className="text-muted text-xs">待分配 · {unassignedRoster.length} 人</p>
              {unassignedRoster.map((r) => (
                <div key={r.uid}
                  className="flex items-center gap-3 bg-navy border border-surface rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{r.displayName}</p>
                    {(r.preferredPositions ?? [])[0] && (
                      <span className="text-[9px] text-teal font-bold">
                        {r.preferredPositions![0]}
                      </span>
                    )}
                  </div>
                  {(isCaptainA || isAdmin) && (
                    <button onClick={() => doAssignTeam(r.uid, 'A')} disabled={busy}
                      className="text-[10px] font-black px-3 py-1.5 rounded-lg border
                                 border-team-a/40 text-team-a hover:bg-team-a/10 transition-colors disabled:opacity-40">
                      → A
                    </button>
                  )}
                  {(isCaptainB || isAdmin) && (
                    <button onClick={() => doAssignTeam(r.uid, 'B')} disabled={busy}
                      className="text-[10px] font-black px-3 py-1.5 rounded-lg border
                                 border-team-b/40 text-team-b hover:bg-team-b/10 transition-colors disabled:opacity-40">
                      → B
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-sm">所有球员已分配完毕</p>
          )}

          {/* Team summaries */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-team-a/5 border border-team-a/20 rounded-xl p-3">
              <p className="text-team-a text-[10px] font-black mb-2 uppercase tracking-wide">
                A队 · {teamAPlayers.length} 人
              </p>
              {teamAPlayers.map((p) => (
                <div key={p.uid} className="flex items-center justify-between py-0.5">
                  <span className="text-white text-xs truncate flex-1">{p.displayName}</span>
                  {isAdmin && (
                    <button onClick={() => doAssignTeam(p.uid, null)} disabled={busy}
                      className="text-muted text-[10px] hover:text-red-hot ml-1 shrink-0 transition-colors">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="bg-team-b/5 border border-team-b/20 rounded-xl p-3">
              <p className="text-team-b text-[10px] font-black mb-2 uppercase tracking-wide">
                B队 · {teamBPlayers.length} 人
              </p>
              {teamBPlayers.map((p) => (
                <div key={p.uid} className="flex items-center justify-between py-0.5">
                  <span className="text-white text-xs truncate flex-1">{p.displayName}</span>
                  {isAdmin && (
                    <button onClick={() => doAssignTeam(p.uid, null)} disabled={busy}
                      className="text-muted text-[10px] hover:text-red-hot ml-1 shrink-0 transition-colors">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Team A tactics ── */}
      {canSeeTeamA && hasTactics && tacticPhase && formationARef && (
        <section className="space-y-3">
          <h2 className="text-[10px] font-black text-team-a uppercase tracking-widest">A 队战术板</h2>
          <Pitch
            players={teamAPlayers}
            saveRef={formationARef}
            canEdit={isCaptainA}
          />
        </section>
      )}

      {/* ── Team B tactics ── */}
      {canSeeTeamB && hasTactics && tacticPhase && formationBRef && (
        <section className="space-y-3">
          <h2 className="text-[10px] font-black text-team-b uppercase tracking-widest">B 队战术板</h2>
          <Pitch
            players={teamBPlayers}
            saveRef={formationBRef}
            canEdit={isCaptainB}
          />
        </section>
      )}

      {/* ── Agreement modal (register) ── */}
      {agreementOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center z-[60] p-4"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="bg-navy-light border border-surface rounded-3xl w-full max-w-sm p-6 space-y-4">
            <div className="w-10 h-1 bg-surface rounded-full mx-auto" />
            <h3 className="font-black text-white text-lg">报名须知</h3>
            <div className="max-h-48 overflow-y-auto">
              <Markdown>{match.agreementText || defaultAgreement || '报名即表示您同意遵守队伍规则并出席已报名的比赛。'}</Markdown>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setAgreementOpen(false)}
                className="flex-1 border border-surface text-slate font-bold py-3.5 rounded-xl
                           hover:border-muted transition-colors">
                取消
              </button>
              <button onClick={() => doRegister(false)} disabled={busy}
                className="flex-1 bg-teal hover:bg-teal-dark text-pitch font-black py-3.5 rounded-xl
                           transition-colors disabled:opacity-40">
                {busy ? '处理中...' : '同意并报名'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Waitlist modal ── */}
      {waitlistModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center z-[60] p-4"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="bg-navy-light border border-surface rounded-3xl w-full max-w-sm p-6 space-y-4">
            <div className="w-10 h-1 bg-surface rounded-full mx-auto" />
            <h3 className="font-black text-white text-lg">加入 Waitlist</h3>

            {/* Agreement text */}
            {(match.agreementText || defaultAgreement) && (
              <div className="bg-surface/40 rounded-xl p-3 max-h-28 overflow-y-auto">
                <Markdown className="text-xs">
                  {match.agreementText || defaultAgreement}
                </Markdown>
              </div>
            )}

            <p className="text-slate text-sm leading-relaxed">
              名额已满，你将排在{' '}
              <span className="text-white font-bold">Waitlist #{waitlist.length + 1}</span>。
              有人退出时按顺序通知。
            </p>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <button role="switch" aria-checked={autoAccept}
                onClick={() => setAutoAccept((v) => !v)}
                className={`w-12 h-6 rounded-full transition-colors relative shrink-0
                  ${autoAccept ? 'bg-teal' : 'bg-surface'}`}>
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                  ${autoAccept ? 'translate-x-6' : 'translate-x-0.5'}`} />
              </button>
              <div>
                <p className="text-white text-sm font-bold">自动接受晋升</p>
                <p className="text-muted text-xs">轮到你时直接确认，无需手动操作</p>
              </div>
            </label>
            {!autoAccept && (
              <p className="text-muted text-xs bg-surface/60 rounded-xl p-3 leading-relaxed">
                晋升后有 30 分钟窗口，超时将跳至下一位候补。
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setWaitlistModal(false)}
                className="flex-1 border border-surface text-slate font-bold py-3.5 rounded-xl
                           hover:border-muted transition-colors">
                取消
              </button>
              <button onClick={() => doRegister(true)} disabled={busy}
                className="flex-1 bg-teal hover:bg-teal-dark text-pitch font-black py-3.5 rounded-xl
                           transition-colors disabled:opacity-40">
                {busy ? '处理中...' : '加入 Waitlist'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Venmo payment modal ── */}
      {venmoModal && defaultVenmoHandle && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end justify-center z-[60] p-4"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="bg-navy-light border border-surface rounded-3xl w-full max-w-sm p-6 space-y-4">
            <div className="w-10 h-1 bg-surface rounded-full mx-auto" />
            <div className="text-center space-y-1">
              <p className="text-gold font-black text-lg">请支付场地费</p>
              <p className="text-white font-black text-4xl">${perSessionFee}</p>
              <p className="text-slate text-sm">@{defaultVenmoHandle}</p>
            </div>
            <p className="text-muted text-xs text-center leading-relaxed">
              次卡会员需支付场地费，报名名额已保留。<br/>
              支付后管理员将手动确认。
            </p>
            <div className="flex gap-3">
              <button onClick={() => setVenmoModal(false)}
                className="flex-1 border border-surface text-slate font-bold py-3.5 rounded-xl
                           hover:border-muted transition-colors">
                稍后支付
              </button>
              <a href={`https://venmo.com/${defaultVenmoHandle}?txn=pay&amount=${perSessionFee}&note=${encodeURIComponent('Match Fee')}`}
                target="_blank" rel="noopener noreferrer"
                onClick={() => setVenmoModal(false)}
                className="flex-1 bg-gold hover:bg-gold/90 text-pitch font-black py-3.5 rounded-xl
                           transition-colors text-center text-sm">
                去 Venmo 支付
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
