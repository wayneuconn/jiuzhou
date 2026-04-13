import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { DEFAULT_THRESHOLDS } from '../../utils/cardTier'
import type { CardThresholds } from '../../types'

export default function AdminSettings() {
  const navigate = useNavigate()

  const [season, setSeason]               = useState('')
  const [thresholds, setThresholds]       = useState<CardThresholds>(DEFAULT_THRESHOLDS)
  const [defaultAgreement, setDefaultAgreement]     = useState('')
  const [defaultAnnouncement, setDefaultAnnouncement] = useState('')
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'config', 'appConfig')).then((snap) => {
      if (snap.exists()) {
        setSeason(snap.data().season ?? '')
        setThresholds(snap.data().cardThresholds ?? DEFAULT_THRESHOLDS)
        setDefaultAgreement(snap.data().defaultAgreementText ?? '')
        setDefaultAnnouncement(snap.data().defaultAnnouncement ?? '')
      }
      setLoading(false)
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await setDoc(doc(db, 'config', 'appConfig'), {
        season,
        cardThresholds: thresholds,
        defaultAgreementText: defaultAgreement,
        defaultAnnouncement,
      }, { merge: true })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  const setThreshold = (key: keyof CardThresholds) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value)
    if (!isNaN(val) && val >= 0) setThresholds((prev) => ({ ...prev, [key]: val }))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin')} className="text-slate hover:text-white transition-colors">
          ← 返回
        </button>
        <h1 className="text-white text-xl font-black">Settings</h1>
      </div>

      {/* Season */}
      <div className="bg-navy border border-surface rounded-2xl p-5 space-y-4">
        <p className="text-white font-black text-sm">赛季</p>
        <div>
          <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">
            当前赛季
          </label>
          <input
            type="text"
            value={loading ? '' : season}
            onChange={(e) => setSeason(e.target.value)}
            placeholder="例如：2025"
            disabled={loading}
            className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                       px-4 py-3.5 text-white placeholder-muted text-base focus:outline-none
                       transition-colors disabled:opacity-50"
          />
          <p className="text-muted text-xs mt-1.5">显示在首页标题旁边</p>
        </div>
      </div>

      {/* Card thresholds */}
      <div className="bg-navy border border-surface rounded-2xl p-5 space-y-4">
        <div>
          <p className="text-white font-black text-sm">球员卡等级门槛</p>
          <p className="text-slate text-xs mt-1">根据出勤次数自动升级，设置每个等级所需的最低次数</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {([
            ['bronze', '铜卡', 'border-bronze text-bronze'],
            ['silver', '银卡', 'border-silver text-silver'],
            ['gold',   '金卡', 'border-gold text-gold'],
            ['blue',   '蓝卡', 'border-royal text-royal'],
          ] as const).map(([key, label, cls]) => (
            <div key={key}>
              <label className={`text-[10px] font-black uppercase tracking-widest block mb-2 ${cls.split(' ')[1]}`}>
                {label}
              </label>
              <div className={`flex items-center rounded-xl overflow-hidden border ${cls.split(' ')[0]} bg-navy-light`}>
                <input
                  type="number"
                  value={thresholds[key]}
                  onChange={setThreshold(key)}
                  min={0}
                  disabled={loading}
                  className="flex-1 px-3 py-3 text-white text-base font-bold focus:outline-none bg-transparent"
                />
                <span className="px-3 text-slate text-xs shrink-0">次</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Default announcement */}
      <div className="bg-navy border border-surface rounded-2xl p-5 space-y-4">
        <div>
          <p className="text-white font-black text-sm">默认公告</p>
          <p className="text-slate text-xs mt-1">无公告时首页显示的内容，支持 Markdown</p>
        </div>
        <textarea
          value={loading ? '' : defaultAnnouncement}
          onChange={(e) => setDefaultAnnouncement(e.target.value)}
          placeholder="欢迎加入九州足球队！"
          rows={4}
          disabled={loading}
          className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                     px-4 py-3 text-white placeholder-muted text-sm focus:outline-none
                     transition-colors resize-none disabled:opacity-50 font-mono"
        />
      </div>

      {/* Default agreement text */}
      <div className="bg-navy border border-surface rounded-2xl p-5 space-y-4">
        <div>
          <p className="text-white font-black text-sm">默认参赛须知</p>
          <p className="text-slate text-xs mt-1">新建比赛时自动预填的协议文本</p>
        </div>
        <textarea
          value={loading ? '' : defaultAgreement}
          onChange={(e) => setDefaultAgreement(e.target.value)}
          placeholder="参加本次比赛即表示同意遵守队规。"
          rows={4}
          disabled={loading}
          className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                     px-4 py-3 text-white placeholder-muted text-sm focus:outline-none
                     transition-colors resize-none disabled:opacity-50"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving || loading}
        className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                   py-4 rounded-xl transition-all duration-150 disabled:opacity-40"
      >
        {saved ? '✓ 已保存' : saving ? '保存中...' : '保存设置'}
      </button>
    </div>
  )
}
