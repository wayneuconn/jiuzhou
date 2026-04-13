import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RecaptchaVerifier,
  linkWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth'
import { doc, updateDoc } from 'firebase/firestore'
import { auth, db } from '../../lib/firebase'
import { useAuthStore } from '../../stores/authStore'

declare global {
  interface Window { recaptchaVerifier?: RecaptchaVerifier }
}

type Step = 'phone' | 'code'

export default function BindPhonePage() {
  const navigate = useNavigate()
  const { firebaseUser, userProfile } = useAuthStore()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<Step>('phone')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const confirmationRef = useRef<ConfirmationResult | null>(null)

  useEffect(() => {
    return () => {
      window.recaptchaVerifier?.clear()
      window.recaptchaVerifier = undefined
    }
  }, [])

  const getRecaptcha = () => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' })
    }
    return window.recaptchaVerifier
  }

  const handleSendCode = async () => {
    setError('')
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) { setError('请输入10位手机号'); return }
    if (!firebaseUser) return
    setLoading(true)
    try {
      const confirmation = await linkWithPhoneNumber(firebaseUser, `+1${digits}`, getRecaptcha())
      confirmationRef.current = confirmation
      setStep('code')
    } catch (e: unknown) {
      const code = (e as { code?: string }).code
      const msg: Record<string, string> = {
        'auth/provider-already-linked': '该账号已绑定手机号',
        'auth/credential-already-in-use': '该手机号已被其他账号使用',
        'auth/too-many-requests': '请求过多，请稍后再试',
      }
      setError(msg[code ?? ''] ?? (e instanceof Error ? e.message : '发送失败'))
      window.recaptchaVerifier?.clear()
      window.recaptchaVerifier = undefined
    } finally { setLoading(false) }
  }

  const handleVerifyCode = async () => {
    if (!confirmationRef.current || !firebaseUser) return
    setError('')
    setLoading(true)
    try {
      await confirmationRef.current.confirm(code.trim())
      // Update phone in Firestore profile
      if (userProfile) {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          phone: `+1${phone.replace(/\D/g, '')}`,
        })
      }
      // If profile incomplete, go to profile onboarding; else go home
      if (!userProfile?.displayName) {
        navigate('/onboard/profile', { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    } catch {
      setError('验证码错误，请重试')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-pitch flex flex-col items-center justify-center px-6">
      <div id="recaptcha-container" />

      {/* Icon */}
      <div className="flex flex-col items-center mb-10">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal to-teal-dark
                        flex items-center justify-center mb-4 shadow-2xl shadow-teal/30">
          <svg viewBox="0 0 24 24" fill="none" stroke="#0D1117" strokeWidth={2.5}
            strokeLinecap="round" strokeLinejoin="round" className="w-9 h-9">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 .91h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
        </div>
        <h1 className="text-white text-2xl font-black tracking-tight">绑定手机号</h1>
        <p className="text-slate text-sm mt-1 text-center max-w-[200px]">
          验证手机号以保护你的账号安全
        </p>
      </div>

      <div className="w-full max-w-sm bg-navy border border-surface rounded-3xl p-8 shadow-2xl shadow-black/60">
        {step === 'phone' ? (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">
                手机号
              </label>
              <div className="flex rounded-xl overflow-hidden border border-surface focus-within:border-teal transition-colors">
                <span className="px-4 py-3.5 bg-surface text-slate font-mono text-base select-none shrink-0">+1</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="2015550100"
                  maxLength={10}
                  className="flex-1 px-4 py-3.5 bg-navy-light text-white placeholder-muted text-base focus:outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                  autoFocus
                />
              </div>
              <p className="text-muted text-xs mt-1.5">输入10位美国手机号</p>
            </div>

            {error && <ErrorBox msg={error} />}

            <button
              onClick={handleSendCode}
              disabled={loading || phone.length < 10}
              className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                         py-4 rounded-xl transition-all duration-150 disabled:opacity-40"
            >
              {loading ? '发送中...' : '发送验证码'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">
                验证码
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                           px-4 py-4 text-3xl font-mono tracking-[0.5em] text-center text-teal
                           focus:outline-none transition-colors placeholder-muted"
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                autoFocus
              />
              <p className="text-muted text-xs mt-1.5">已发送至 +1 {phone}</p>
            </div>

            {error && <ErrorBox msg={error} />}

            <button
              onClick={handleVerifyCode}
              disabled={loading || code.length < 6}
              className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                         py-4 rounded-xl transition-all duration-150 disabled:opacity-40"
            >
              {loading ? '验证中...' : '验证并绑定'}
            </button>
            <button
              onClick={() => { setStep('phone'); setCode(''); setError('') }}
              className="w-full text-slate hover:text-white text-sm font-medium transition-colors py-1"
            >
              ← 返回
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <p className="text-red-hot text-sm bg-red-hot/10 border border-red-hot/20 px-3 py-2 rounded-lg">
      {msg}
    </p>
  )
}
