import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../lib/firebase'

declare global {
  interface Window { recaptchaVerifier?: RecaptchaVerifier }
}

const isWeChat = /MicroMessenger/i.test(navigator.userAgent)

type Tab = 'phone' | 'email'
type EmailMode = 'login' | 'register'
type PhoneStep = 'phone' | 'code'

export default function LoginPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('phone')

  // Phone state
  const [phone, setPhone] = useState(localStorage.getItem('jz_phone') ?? '')
  const [code, setCode] = useState('')
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('phone')
  const confirmationRef = useRef<ConfirmationResult | null>(null)

  // Email state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailMode, setEmailMode] = useState<EmailMode>('login')

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setError('')
  }, [tab, emailMode, phoneStep])

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

  const ensureUserProfile = async (uid: string, phoneNumber?: string) => {
    const ref = doc(db, 'users', uid)
    if (!(await getDoc(ref)).exists()) {
      await setDoc(ref, {
        displayName: '',
        phone: phoneNumber ?? '',
        preferredPositions: [],
        role: 'guest',
        membershipStatus: 'pending',
        paymentStatus: 'unpaid',
        createdAt: serverTimestamp(),
      })
    }
  }

  // ── Phone OTP ──────────────────────────────────────────────────────────────
  const handleSendCode = async () => {
    setError('')
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) { setError('请输入10位手机号'); return }
    setLoading(true)
    try {
      const confirmation = await signInWithPhoneNumber(auth, `+1${digits}`, getRecaptcha())
      confirmationRef.current = confirmation
      localStorage.setItem('jz_phone', phone)
      setPhoneStep('code')
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
      await ensureUserProfile(result.user.uid, `+1${phone.replace(/\D/g, '')}`)
      navigate('/')
    } catch {
      setError('验证码错误，请重试')
    } finally { setLoading(false) }
  }

  // ── Email / Password ───────────────────────────────────────────────────────
  const handleEmailAuth = async () => {
    setError('')
    if (!email.trim()) { setError('请输入邮箱'); return }
    if (password.length < 6) { setError('密码至少6位'); return }
    if (emailMode === 'register' && password !== confirmPassword) {
      setError('两次密码不一致'); return
    }
    setLoading(true)
    try {
      if (emailMode === 'register') {
        const result = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await ensureUserProfile(result.user.uid)
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      }
      navigate('/')
    } catch (e: unknown) {
      const code = (e as { code?: string }).code
      const msg: Record<string, string> = {
        'auth/user-not-found': '账号不存在，请先注册',
        'auth/wrong-password': '密码错误',
        'auth/email-already-in-use': '邮箱已注册，请直接登录',
        'auth/invalid-email': '邮箱格式不正确',
        'auth/invalid-credential': '邮箱或密码错误',
      }
      setError(msg[code ?? ''] ?? (e instanceof Error ? e.message : '登录失败'))
    } finally { setLoading(false) }
  }

  // ── Google ─────────────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setError('')
    setLoading(true)
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      await ensureUserProfile(result.user.uid, result.user.phoneNumber ?? undefined)
      navigate('/')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Google 登录失败')
    } finally { setLoading(false) }
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

      {/* Card */}
      <div className="w-full max-w-sm bg-navy border border-surface rounded-3xl p-8 shadow-2xl shadow-black/60">

        {/* Tab switcher */}
        <div className="flex bg-surface rounded-xl p-1 mb-6">
          {(['phone', 'email'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-150
                ${tab === t ? 'bg-navy text-white shadow-sm' : 'text-slate hover:text-white'}`}
            >
              {t === 'phone' ? '手机号' : '邮箱'}
            </button>
          ))}
        </div>

        {/* ── Phone tab ─────────────────────────────────────────────────── */}
        {tab === 'phone' && (
          <div className="space-y-4">
            {phoneStep === 'phone' ? (
              <>
                <div>
                  <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">
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

                {error && <ErrorBox msg={error} />}

                <PrimaryBtn onClick={handleSendCode} loading={loading} disabled={phone.length < 10}>
                  发送验证码
                </PrimaryBtn>
              </>
            ) : (
              <>
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

                <PrimaryBtn onClick={handleVerifyCode} loading={loading} disabled={code.length < 6}>
                  验证
                </PrimaryBtn>
                <button
                  onClick={() => { setPhoneStep('phone'); setCode(''); setError('') }}
                  className="w-full text-slate hover:text-white text-sm font-medium transition-colors py-1"
                >
                  ← 返回
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Email tab ─────────────────────────────────────────────────── */}
        {tab === 'email' && (
          <div className="space-y-4">
            {/* Register / Login toggle */}
            <div className="flex items-center justify-center gap-1 text-sm mb-2">
              <button
                onClick={() => setEmailMode('login')}
                className={`px-3 py-1 rounded-lg font-bold transition-colors
                  ${emailMode === 'login' ? 'text-white' : 'text-slate hover:text-white'}`}
              >
                登录
              </button>
              <span className="text-surface">|</span>
              <button
                onClick={() => setEmailMode('register')}
                className={`px-3 py-1 rounded-lg font-bold transition-colors
                  ${emailMode === 'register' ? 'text-white' : 'text-slate hover:text-white'}`}
              >
                注册
              </button>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">
                邮箱
              </label>
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                           px-4 py-3.5 text-white placeholder-muted text-base focus:outline-none transition-colors"
                autoFocus
              />
            </div>

            <div>
              <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少6位"
                className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                           px-4 py-3.5 text-white placeholder-muted text-base focus:outline-none transition-colors"
                onKeyDown={(e) => e.key === 'Enter' && emailMode === 'login' && handleEmailAuth()}
              />
            </div>

            {emailMode === 'register' && (
              <div>
                <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">
                  确认密码
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入密码"
                  className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                             px-4 py-3.5 text-white placeholder-muted text-base focus:outline-none transition-colors"
                  onKeyDown={(e) => e.key === 'Enter' && handleEmailAuth()}
                />
              </div>
            )}

            {error && <ErrorBox msg={error} />}

            <PrimaryBtn onClick={handleEmailAuth} loading={loading}>
              {emailMode === 'login' ? '登录' : '注册账号'}
            </PrimaryBtn>
          </div>
        )}

        {/* Google sign-in (non-WeChat, below both tabs) */}
        {!isWeChat && (
          <div className="mt-4 space-y-3">
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

function PrimaryBtn({
  children, onClick, loading, disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  loading?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                 py-4 rounded-xl transition-all duration-150 disabled:opacity-40 text-base tracking-wide"
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span className="w-4 h-4 border-2 border-pitch border-t-transparent rounded-full animate-spin" />
          请稍候...
        </span>
      ) : children}
    </button>
  )
}
