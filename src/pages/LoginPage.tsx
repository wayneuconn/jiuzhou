import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'

declare global {
  interface Window { recaptchaVerifier?: RecaptchaVerifier }
}

const isWeChat = /MicroMessenger/i.test(navigator.userAgent)

export default function LoginPage() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState(localStorage.getItem('jz_phone') ?? '')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'phone' | 'code'>('phone')
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
    setLoading(true)
    try {
      const confirmation = await signInWithPhoneNumber(auth, `+1${digits}`, getRecaptcha())
      confirmationRef.current = confirmation
      localStorage.setItem('jz_phone', phone)
      setStep('code')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '发送失败，请重试')
      window.recaptchaVerifier?.clear()
      window.recaptchaVerifier = undefined
    } finally { setLoading(false) }
  }

  const handleVerifyCode = async () => {
    if (!confirmationRef.current) return
    setError('')
    setLoading(true)
    try {
      const result = await confirmationRef.current.confirm(code.trim())
      await ensureUserProfile(result.user.uid, phone)
      navigate('/')
    } catch {
      setError('验证码错误，请重试')
    } finally { setLoading(false) }
  }

  const handleGoogleSignIn = async () => {
    setError('')
    setLoading(true)
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      await ensureUserProfile(result.user.uid, result.user.phoneNumber ?? '')
      navigate('/')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Google 登录失败')
    } finally { setLoading(false) }
  }

  const ensureUserProfile = async (uid: string, phoneNumber: string) => {
    const ref = doc(db, 'users', uid)
    if (!(await getDoc(ref)).exists()) {
      await setDoc(ref, {
        displayName: '',
        phone: phoneNumber,
        preferredPositions: [],
        role: 'guest',
        membershipStatus: 'pending',
        paymentStatus: 'unpaid',
        createdAt: serverTimestamp(),
      })
    }
  }

  return (
    <div className="min-h-screen bg-pitch flex flex-col items-center justify-center px-6">
      <div id="recaptcha-container" />

      {/* Logo */}
      <div className="flex flex-col items-center mb-10">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal to-teal-dark
                        flex items-center justify-center mb-4 shadow-2xl shadow-teal/30">
          <span className="text-pitch text-3xl font-black">九</span>
        </div>
        <h1 className="text-white text-4xl font-black tracking-tight">九州</h1>
        <p className="text-slate text-xs mt-1 tracking-[0.3em] uppercase">Football Team</p>
      </div>

      {/* Form card */}
      <div className="w-full max-w-sm bg-navy border border-surface rounded-3xl p-8 shadow-2xl shadow-black/60">
        {step === 'phone' ? (
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-slate uppercase tracking-widest mb-2">
                手机号
              </label>
              <div className="flex rounded-xl overflow-hidden border border-surface focus-within:border-teal transition-colors">
                <span className="px-4 py-3.5 bg-surface text-slate font-mono text-base select-none shrink-0">
                  +1
                </span>
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

            {error && (
              <p className="text-red-hot text-sm bg-red-hot/10 border border-red-hot/20 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <button
              onClick={handleSendCode}
              disabled={loading || phone.length < 10}
              className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                         py-4 rounded-xl transition-all duration-150 disabled:opacity-40 text-base tracking-wide"
            >
              {loading ? '发送中...' : '发送验证码'}
            </button>

            {!isWeChat && (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t border-surface" />
                  <span className="text-muted text-xs">或</span>
                  <div className="flex-1 border-t border-surface" />
                </div>
                <button
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full bg-navy-light border border-surface hover:border-slate text-white
                             font-medium py-3.5 rounded-xl flex items-center justify-center gap-3
                             transition-all duration-150 disabled:opacity-40"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/>
                    <path fill="#34A853" d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.615 24 12.255 24z"/>
                    <path fill="#FBBC05" d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"/>
                    <path fill="#EA4335" d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.64 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/>
                  </svg>
                  Continue with Google
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-slate uppercase tracking-widest mb-2">
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

            {error && (
              <p className="text-red-hot text-sm bg-red-hot/10 border border-red-hot/20 px-3 py-2 rounded-lg">
                {error}
              </p>
            )}

            <button
              onClick={handleVerifyCode}
              disabled={loading || code.length < 6}
              className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                         py-4 rounded-xl transition-all duration-150 disabled:opacity-40 text-base"
            >
              {loading ? '验证中...' : '验证'}
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
