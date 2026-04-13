import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  collection, getDocs, addDoc, updateDoc, doc,
  serverTimestamp, query, orderBy,
} from 'firebase/firestore'
import { db } from '../../lib/firebase'
import type { Match, MatchStatus } from '../../types'

// Status display config
const STATUS_LABEL: Record<MatchStatus, string> = {
  draft:          '草稿',
  registration_r1:'报名 R1',
  registration_r2:'报名 R2',
  drafting:       '选人中',
  ready:          '已就绪',
  completed:      '已结束',
}
const STATUS_COLOR: Record<MatchStatus, string> = {
  draft:          'text-slate border-surface bg-surface',
  registration_r1:'text-teal border-teal/30 bg-teal/10',
  registration_r2:'text-teal border-teal/30 bg-teal/10',
  drafting:       'text-gold border-gold/30 bg-gold/10',
  ready:          'text-teal border-teal/30 bg-teal/10',
  completed:      'text-muted border-surface bg-surface',
}

// What the "next" button should say
const NEXT_ACTION: Partial<Record<MatchStatus, { label: string; next: MatchStatus }>> = {
  draft:          { label: '开启报名 R1（仅年卡）', next: 'registration_r1' },
  registration_r1:{ label: '开启报名 R2（所有人）', next: 'registration_r2' },
  registration_r2:{ label: '关闭报名 → 开始选人',  next: 'drafting' },
  drafting:       { label: '完成选人 → 就绪',       next: 'ready' },
  ready:          { label: '标记为已结束',           next: 'completed' },
}

export default function AdminMatches() {
  const navigate = useNavigate()
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState<string | null>(null)

  // Form fields
  const [date, setDate] = useState('')
  const [time, setTime] = useState('19:00')
  const [location, setLocation] = useState('')
  const [maxPlayers, setMaxPlayers] = useState('22')
  const [agreementText, setAgreementText] = useState('')
  const [creating, setCreating] = useState(false)

  const load = async () => {
    const snap = await getDocs(query(collection(db, 'matches'), orderBy('date', 'desc')))
    setMatches(snap.docs.map((d) => ({
      id: d.id, ...d.data(),
      date: d.data().date?.toDate(),
      createdAt: d.data().createdAt?.toDate(),
    })) as Match[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!date || !location.trim()) return
    setCreating(true)
    try {
      const datetime = new Date(`${date}T${time}`)
      await addDoc(collection(db, 'matches'), {
        date: datetime,
        location: location.trim(),
        maxPlayers: parseInt(maxPlayers) || 22,
        status: 'draft',
        agreementText: agreementText.trim() || '参加本次比赛即表示同意遵守队规。',
        captainA: null,
        captainB: null,
        createdAt: serverTimestamp(),
      })
      setDate(''); setLocation(''); setMaxPlayers('22'); setAgreementText('')
      setShowForm(false)
      await load()
    } finally { setCreating(false) }
  }

  const handleAdvance = async (match: Match) => {
    const action = NEXT_ACTION[match.status]
    if (!action) return
    setAdvancing(match.id)
    try {
      await updateDoc(doc(db, 'matches', match.id), { status: action.next })
      setMatches((prev) => prev.map((m) => m.id === match.id ? { ...m, status: action.next } : m))
    } finally { setAdvancing(null) }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin')} className="text-slate hover:text-white transition-colors">
          ← 返回
        </button>
        <h1 className="text-white text-xl font-black">Matches</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto bg-teal hover:bg-teal-dark text-pitch font-black
                     text-xs px-4 py-2 rounded-xl transition-colors"
        >
          {showForm ? '取消' : '+ 新建活动'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-navy border border-surface rounded-2xl p-5 space-y-4">
          <p className="text-white font-black text-sm">新建比赛</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">日期</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                           px-4 py-3 text-white text-sm focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">时间</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                           px-4 py-3 text-white text-sm focus:outline-none transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">地点</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="例如：Randall's Island Field 83"
              className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                         px-4 py-3 text-white placeholder-muted text-sm focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">最大人数</label>
            <input
              type="number"
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(e.target.value)}
              min={2}
              max={40}
              className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                         px-4 py-3 text-white text-sm focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">
              参赛须知 <span className="text-muted normal-case font-normal tracking-normal">(可选)</span>
            </label>
            <textarea
              value={agreementText}
              onChange={(e) => setAgreementText(e.target.value)}
              placeholder="参加本次比赛即表示同意遵守队规。"
              rows={3}
              className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                         px-4 py-3 text-white placeholder-muted text-sm focus:outline-none
                         transition-colors resize-none"
            />
          </div>

          <button
            onClick={handleCreate}
            disabled={creating || !date || !location.trim()}
            className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                       py-4 rounded-xl transition-all duration-150 disabled:opacity-40"
          >
            {creating ? '创建中...' : '创建比赛（草稿）'}
          </button>
          <p className="text-muted text-xs text-center">创建后可在列表中开启报名</p>
        </div>
      )}

      {/* Matches list */}
      {matches.length === 0 ? (
        <div className="bg-navy border border-surface rounded-2xl p-8 text-center">
          <p className="text-slate text-sm">暂无比赛</p>
          <p className="text-muted text-xs mt-1">点击「+ 新建活动」创建第一场比赛</p>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map((match) => {
            const action = NEXT_ACTION[match.status]
            const isExpanded = expandedId === match.id
            const busy = advancing === match.id

            return (
              <div key={match.id} className="bg-navy border border-surface rounded-2xl overflow-hidden">
                {/* Match row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : match.id)}
                  className="w-full p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-bold text-sm">
                        {match.date?.toLocaleDateString('zh-CN', {
                          month: 'long', day: 'numeric', weekday: 'short',
                        })}
                        {' '}
                        <span className="text-slate font-normal">
                          {match.date?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </p>
                      <p className="text-slate text-xs mt-0.5 truncate">{match.location}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border
                                       ${STATUS_COLOR[match.status]}`}>
                        {STATUS_LABEL[match.status]}
                      </span>
                      <svg
                        className={`w-4 h-4 text-slate transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </button>

                {/* Expanded controls */}
                {isExpanded && (
                  <div className="border-t border-surface px-4 pb-4 pt-3 space-y-3">
                    <div className="flex items-center gap-3 text-xs text-slate">
                      <span>最多 {match.maxPlayers} 人</span>
                      <span>·</span>
                      <Link
                        to={`/match/${match.id}`}
                        className="text-teal hover:text-teal-dark transition-colors font-semibold"
                      >
                        查看报名列表 →
                      </Link>
                    </div>

                    {/* Status progression */}
                    {action && (
                      <button
                        onClick={() => handleAdvance(match)}
                        disabled={busy}
                        className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                                   py-3 rounded-xl transition-all duration-150 disabled:opacity-40 text-sm"
                      >
                        {busy ? '更新中...' : action.label}
                      </button>
                    )}

                    {match.status === 'completed' && (
                      <p className="text-center text-muted text-xs">已结束</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
