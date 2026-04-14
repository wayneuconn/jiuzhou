import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, updateDoc, orderBy, query } from 'firebase/firestore'
import { db } from '../../lib/firebase'
import { useAuthStore } from '../../stores/authStore'
import type { User, MembershipType, UserRole } from '../../types'

const membershipLabel: Record<MembershipType, string> = {
  annual:      '年卡',
  per_session: '次卡',
  none:        '未激活',
}
const roleLabel: Record<UserRole, string> = {
  admin:  'Admin',
  member: '成员',
  guest:  '访客',
}

export default function AdminMembers() {
  const navigate = useNavigate()
  const { userProfile: me } = useAuthStore()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  const load = async () => {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')))
    setUsers(snap.docs.map((d) => ({
      uid: d.id,
      ...d.data(),
      membershipType:  d.data().membershipType ?? 'none',
      lateCount:       d.data().lateCount ?? 0,
      dangerousCount:  d.data().dangerousCount ?? 0,
      createdAt:       d.data().createdAt?.toDate(),
    })) as User[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const update = async (uid: string, fields: Partial<Pick<User, 'role' | 'membershipType'>>) => {
    setUpdating(uid)
    try {
      await updateDoc(doc(db, 'users', uid), fields)
      setUsers((prev) => prev.map((u) => u.uid === uid ? { ...u, ...fields } : u))
    } finally { setUpdating(null) }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-teal border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin')} className="text-slate hover:text-white transition-colors">
          ← 返回
        </button>
        <h1 className="text-white text-xl font-black">Members</h1>
        <span className="ml-auto text-slate text-sm">{users.length} 人</span>
      </div>

      <div className="space-y-3">
        {[...users]
          .sort((a, b) => {
            const fa = (a.lateCount || 0) + (a.dangerousCount || 0)
            const fb = (b.lateCount || 0) + (b.dangerousCount || 0)
            if (fa >= 3 && fb < 3) return -1
            if (fb >= 3 && fa < 3) return 1
            return fb - fa
          })
          .map((u) => {
          const isSelf    = u.uid === me?.uid
          const busy      = updating === u.uid
          const initial   = (u.displayName || u.phone).charAt(0).toUpperCase()
          const flagCount = (u.lateCount || 0) + (u.dangerousCount || 0)
          const flagged   = flagCount >= 3

          return (
            <div key={u.uid} className={`border rounded-2xl p-4
              ${flagged ? 'bg-red-hot/5 border-red-hot/40' : 'bg-navy border-surface'}`}>
              {/* Header row */}
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0
                  ${flagged
                    ? 'bg-red-hot/20'
                    : 'bg-gradient-to-br from-teal to-teal-dark'}`}>
                  <span className={`text-sm font-black ${flagged ? 'text-red-hot' : 'text-pitch'}`}>
                    {initial}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm truncate">
                    {u.displayName || <span className="text-slate">未设置名字</span>}
                    {isSelf && <span className="text-muted text-xs ml-1">(我)</span>}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <p className="text-slate text-xs">{u.phone}</p>
                    {u.lateCount > 0 && (
                      <span className="text-[10px] font-black text-gold">迟到×{u.lateCount}</span>
                    )}
                    {u.dangerousCount > 0 && (
                      <span className="text-[10px] font-black text-red-hot">危险×{u.dangerousCount}</span>
                    )}
                  </div>
                  {u.preferredPositions?.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {u.preferredPositions.map((pos) => (
                        <span key={pos} className="text-[10px] font-bold text-teal bg-teal/10
                                                   border border-teal/20 px-1.5 py-0.5 rounded">
                          {pos}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex gap-1.5">
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border
                    ${u.role === 'admin'
                      ? 'text-gold border-gold/30 bg-gold/10'
                      : 'text-slate border-surface bg-surface'}`}>
                    {roleLabel[u.role]}
                  </span>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border
                    ${(u.role === 'admin' || u.membershipType === 'annual')
                      ? 'text-teal border-teal/30 bg-teal/10'
                      : u.membershipType === 'per_session'
                      ? 'text-gold border-gold/30 bg-gold/10'
                      : 'text-slate border-surface bg-surface'}`}>
                    {u.role === 'admin' ? '年卡' : membershipLabel[u.membershipType]}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              {!isSelf && (
                <div className="flex flex-wrap gap-2">
                  {/* Role toggle */}
                  {u.role !== 'admin' ? (
                    <ActionBtn
                      onClick={() => update(u.uid, { role: 'admin' })}
                      disabled={busy}
                      variant="gold"
                    >
                      设为 Admin
                    </ActionBtn>
                  ) : (
                    <ActionBtn
                      onClick={() => update(u.uid, { role: 'member' })}
                      disabled={busy}
                      variant="slate"
                    >
                      取消 Admin
                    </ActionBtn>
                  )}

                  {/* Membership type — not applicable to admins */}
                  {u.role !== 'admin' && (<>
                    {u.membershipType !== 'annual' && (
                      <ActionBtn
                        onClick={() => update(u.uid, { membershipType: 'annual' })}
                        disabled={busy}
                        variant="teal"
                      >
                        设为年卡
                      </ActionBtn>
                    )}
                    {u.membershipType !== 'per_session' && (
                      <ActionBtn
                        onClick={() => update(u.uid, { membershipType: 'per_session' })}
                        disabled={busy}
                        variant="slate"
                      >
                        设为次卡
                      </ActionBtn>
                    )}
                    {u.membershipType !== 'none' && (
                      <ActionBtn
                        onClick={() => update(u.uid, { membershipType: 'none' })}
                        disabled={busy}
                        variant="red"
                      >
                        清除会员
                      </ActionBtn>
                    )}
                  </>)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}


function ActionBtn({
  children,
  onClick,
  disabled,
  variant,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled: boolean
  variant: 'teal' | 'gold' | 'slate' | 'red'
}) {
  const styles = {
    teal:  'border-teal/40 text-teal hover:bg-teal/10',
    gold:  'border-gold/40 text-gold hover:bg-gold/10',
    slate: 'border-surface text-slate hover:border-slate/50 hover:text-white',
    red:   'border-red-hot/40 text-red-hot hover:bg-red-hot/10',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all duration-150
                  disabled:opacity-40 ${styles[variant]}`}
    >
      {children}
    </button>
  )
}
