import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../../lib/firebase'

export default function AdminSettings() {
  const navigate = useNavigate()
  const [season, setSeason] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'config', 'appConfig')).then((snap) => {
      if (snap.exists()) setSeason(snap.data().season ?? '')
      setLoading(false)
    })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      await setDoc(doc(db, 'config', 'appConfig'), { season }, { merge: true })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin')}
          className="text-slate hover:text-white transition-colors">
          ← 返回
        </button>
        <h1 className="text-white text-xl font-black">Settings</h1>
      </div>

      <div className="bg-navy border border-surface rounded-2xl p-5 space-y-4">
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

        <button
          onClick={handleSave}
          disabled={saving || loading || !season.trim()}
          className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                     py-4 rounded-xl transition-all duration-150 disabled:opacity-40"
        >
          {saved ? '✓ 已保存' : saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}
