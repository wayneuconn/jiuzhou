import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
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
type RegStep = 1 | 2 | 3  // 1=credentials, 2=phone, 3=otp

// ─── Shared sub-components ─────────────────────────────────────────────────

function ErrorBox({ msg }: { msg: string }) {
  return (
    <p className="text-red-hot text-sm bg-red-hot/10 border border-red-hot/20 px-3 py-2 rounded-lg">
      {msg}
    </p>
  )
}

function PrimaryBtn({
  children, onClick, loading, disabled,
}: { children: React.ReactNode; onClick: () => void; loading?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="w-full bg-teal hover:bg-teal-dark active:scale-95 text-pitch font-black
                 py-4 rounded-xl transition-all duration-150 disabled:opacity-40 text-base tracking-wide"
    >
      {loading
        ? <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-pitch border-t-transparent rounded-full animate-spin" />
            请稍候...
          </span>
        : children}
    </button>
  )
}

function BackBtn({ onClick, label = '← 返回' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-slate hover:text-white text-sm font-medium transition-colors py-1"
    >
      {label}
    </button>
  )
}

function ResendRow({ countdown, onResend, loading }: { countdown: number; onResend: () => void; loading: boolean }) {
  if (countdown > 0) {
    return (
      <p className="text-center text-slate text-sm">
        <span className="text-teal font-bold">{countdown}s</span> 后可重新发送
      </p>
    )
  }
  return (
    <button
      onClick={onResend}
      disabled={loading}
      className="w-full text-teal hover:text-teal-dark text-sm font-semibold
                 transition-colors disabled:opacity-40 py-1"
    >
      重新发送验证码
    </button>
  )
}

function OtpInput({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter?: () => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      placeholder="000000"
      maxLength={6}
      className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                 px-4 py-4 text-3xl font-mono tracking-[0.5em] text-center text-teal
                 focus:outline-none transition-colors placeholder-muted"
      onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      autoFocus
    />
  )
}

// ─── Main component ────────────────────────────────────────────────────────

export default function LoginPage() {
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('phone')
  const [emailMode, setEmailMode] = useState<EmailMode>('login')
  const [phoneStep, setPhoneStep] = useState<PhoneStep>('phone')
  const [regStep, setRegStep] = useState<RegStep>(1)

  // Phone tab
  const [phone, setPhone] = useState(localStorage.getItem('jz_phone') ?? '')
  const [code, setCode] = useState('')
  const phoneConfirmRef = useRef<ConfirmationResult | null>(null)

  // Email tab
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  // Registration phone step
  const [regPhone, setRegPhone] = useState('')
  const [regCode, setRegCode] = useState('')
  const regConfirmRef = useRef<ConfirmationResult | null>(null)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  // Clear error on tab / mode / step change
  useEffect(() => { setError('') }, [tab, emailMode, phoneStep, regStep])

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
        membershipType: 'none',
        createdAt: serverTimestamp(),
      })
    }
  }

  const authErrMsg = (e: unknown): string => {
    const code = (e as { code?: string }).code ?? ''
    const map: Record<string, string> = {
      'auth/invalid-verification-code': '验证码错误，请重试',
      'auth/code-expired':              '验证码已过期，请重新发送',
      'auth/too-many-requests':          '请求过多，请稍后再试',
      'auth/credential-already-in-use': '该手机号已注册，请直接用手机号登录',
      'auth/email-already-in-use':      '该邮箱已注册，请直接登录',
      'auth/user-not-found':            '账号不存在，请先注册',
      'auth/wrong-password':            '密码错误',
      'auth/invalid-credential':        '邮箱或密码错误',
      'auth/invalid-email':             '邮箱格式不正确',
    }
    return map[code] ?? (e instanceof Error ? e.message : '操作失败，请重试')
  }

  // ── Phone tab ─────────────────────────────────────────────────────────────

  const sendPhoneCode = useCallback(async (phoneVal: string) => {
    setError('')
    const digits = phoneVal.replace(/\D/g, '')
    if (digits.length !== 10) { setError('请输入10位手机号'); return false }
    setLoading(true)
    try {
      const conf = await signInWithPhoneNumber(auth, `+1${digits}`, getRecaptcha())
      phoneConfirmRef.current = conf
      localStorage.setItem('jz_phone', phoneVal)
      setCountdown(60)
      return true
    } catch (e) {
      setError(authErrMsg(e))
      window.recaptchaVerifier?.clear()
      window.recaptchaVerifier = undefined
      return false
    } finally { setLoading(false) }
  }, [])

  const handleSendPhoneCode = async () => {
    if (await sendPhoneCode(phone)) setPhoneStep('code')
  }

  const handleResendPhoneCode = async () => {
    window.recaptchaVerifier?.clear()
    window.recaptchaVerifier = undefined
    await sendPhoneCode(phone)
  }

  const handleVerifyPhone = async () => {
    if (!phoneConfirmRef.current) return
    setError('')
    setLoading(true)
    try {
      const result = await phoneConfirmRef.current.confirm(code.trim())
      await ensureUserProfile(result.user.uid, `+1${phone.replace(/\D/g, '')}`)
      navigate('/')
    } catch (e) { setError(authErrMsg(e)) }
    finally { setLoading(false) }
  }

  // ── Email login ───────────────────────────────────────────────────────────

  const handleEmailLogin = async () => {
    setError('')
    if (!email.trim() || password.length < 6) { setError('请检查邮箱和密码'); return }
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      navigate('/')
    } catch (e) { setError(authErrMsg(e)) }
    finally { setLoading(false) }
  }

  // ── Email registration — 3 steps ─────────────────────────────────────────

  const handleRegStep1 = () => {
    setError('')
    if (!email.trim()) { setError('请输入邮箱'); return }
    if (password.length < 6) { setError('密码至少6位'); return }
    if (password !== confirmPassword) { setError('两次密码不一致'); return }
    setRegStep(2)
  }

  const handleRegSendCode = async () => {
    setError('')
    const digits = regPhone.replace(/\D/g, '')
    if (digits.length !== 10) { setError('请输入10位手机号'); return }
    setLoading(true)
    try {
      window.recaptchaVerifier?.clear()
      window.recaptchaVerifier = undefined
      const conf = await signInWithPhoneNumber(auth, `+1${digits}`, getRecaptcha())
      regConfirmRef.current = conf
      setRegStep(3)
      setCountdown(60)
    } catch (e) {
      setError(authErrMsg(e))
      window.recaptchaVerifier?.clear()
      window.recaptchaVerifier = undefined
    } finally { setLoading(false) }
  }

  const handleRegResend = async () => {
    setError('')
    const digits = regPhone.replace(/\D/g, '')
    setLoading(true)
    try {
      window.recaptchaVerifier?.clear()
      window.recaptchaVerifier = undefined
      const conf = await signInWithPhoneNumber(auth, `+1${digits}`, getRecaptcha())
      regConfirmRef.current = conf
      setCountdown(60)
    } catch (e) { setError(authErrMsg(e)) }
    finally { setLoading(false) }
  }

  // Step 3: verify OTP → phone account created → link email cred → profile
  const handleRegVerify = async () => {
    if (!regConfirmRef.current) return
    setError('')
    setLoading(true)
    try {
      // 1. Verify OTP — creates the Firebase account (phone-primary)
      const result = await regConfirmRef.current.confirm(regCode.trim())
      const user = result.user

      // 2. Link email/password credential to the phone account
      const emailCred = EmailAuthProvider.credential(email.trim(), password)
      await linkWithCredential(user, emailCred)

      // 3. Create Firestore profile
      await ensureUserProfile(user.uid, `+1${regPhone.replace(/\D/g, '')}`)

      // 4. New user → profile setup
      navigate('/onboard/profile', { replace: true })
    } catch (e) { setError(authErrMsg(e)) }
    finally { setLoading(false) }
  }

  // ── Google ─────────────────────────────────────────────────────────────────

  const handleGoogleSignIn = async () => {
    setError('')
    setLoading(true)
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider())
      await ensureUserProfile(result.user.uid, result.user.phoneNumber ?? undefined)
      navigate('/')
    } catch (e) { setError(authErrMsg(e)) }
    finally { setLoading(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-pitch flex flex-col items-center justify-center px-6 py-12">
      <div id="recaptcha-container" />

      {/* Logo */}
      <div className="flex flex-col items-center mb-8">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal to-teal-dark
                        flex items-center justify-center mb-4 shadow-2xl shadow-teal/30">
          <span className="text-pitch text-3xl font-black">九</span>
        </div>
        <h1 className="text-white text-4xl font-black tracking-tight">九州</h1>
        <p className="text-slate text-xs mt-1 tracking-[0.3em] uppercase">Football Team</p>
      </div>

      <div className="w-full max-w-sm bg-navy border border-surface rounded-3xl p-8 shadow-2xl shadow-black/60">

        {/* Tab switcher — only show when not deep in registration flow */}
        {!(emailMode === 'register' && regStep > 1) && (
          <div className="flex bg-surface rounded-xl p-1 mb-6">
            {(['phone', 'email'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(''); setPhoneStep('phone'); setRegStep(1) }}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-150
                  ${tab === t ? 'bg-navy text-white shadow-sm' : 'text-slate hover:text-white'}`}
              >
                {t === 'phone' ? '手机号' : '邮箱'}
              </button>
            ))}
          </div>
        )}

        {/* ── Phone tab ─────────────────────────────────────────────── */}
        {tab === 'phone' && (
          <div className="space-y-4">
            {phoneStep === 'phone' ? (
              <>
                <PhoneInput value={phone} onChange={setPhone} onEnter={handleSendPhoneCode} />
                {error && <ErrorBox msg={error} />}
                <PrimaryBtn onClick={handleSendPhoneCode} loading={loading} disabled={phone.length < 10}>
                  发送验证码
                </PrimaryBtn>
              </>
            ) : (
              <>
                <SentTo phone={phone} />
                <OtpInput value={code} onChange={setCode} onEnter={handleVerifyPhone} />
                {error && <ErrorBox msg={error} />}
                <PrimaryBtn onClick={handleVerifyPhone} loading={loading} disabled={code.length < 6}>
                  验证
                </PrimaryBtn>
                <ResendRow countdown={countdown} onResend={handleResendPhoneCode} loading={loading} />
                <BackBtn onClick={() => { setPhoneStep('phone'); setCode(''); setError('') }} />
              </>
            )}
          </div>
        )}

        {/* ── Email tab ─────────────────────────────────────────────── */}
        {tab === 'email' && (
          <div className="space-y-4">
            {/* Login/Register mode toggle */}
            {regStep === 1 && (
              <div className="flex items-center justify-center gap-1 text-sm -mt-2 mb-1">
                {(['login', 'register'] as EmailMode[]).map((m) => (
                  <button key={m} onClick={() => { setEmailMode(m); setError('') }}
                    className={`px-3 py-1 rounded-lg font-bold transition-colors
                      ${emailMode === m ? 'text-white' : 'text-slate hover:text-white'}`}>
                    {m === 'login' ? '登录' : '注册'}
                  </button>
                ))}
              </div>
            )}

            {/* Step 1 — email + password */}
            {regStep === 1 && (
              <>
                <div>
                  <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">邮箱</label>
                  <input type="email" inputMode="email" value={email}
                    onChange={(e) => setEmail(e.target.value)} placeholder="your@email.com" autoFocus
                    className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                               px-4 py-3.5 text-white placeholder-muted text-base focus:outline-none transition-colors"
                    onKeyDown={(e) => e.key === 'Enter' && emailMode === 'login' && handleEmailLogin()}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">密码</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少6位"
                    className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                               px-4 py-3.5 text-white placeholder-muted text-base focus:outline-none transition-colors"
                    onKeyDown={(e) => e.key === 'Enter' && emailMode === 'login' && handleEmailLogin()}
                  />
                </div>
                {emailMode === 'register' && (
                  <div>
                    <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">确认密码</label>
                    <input type="password" value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次输入密码"
                      className="w-full bg-navy-light border border-surface focus:border-teal rounded-xl
                                 px-4 py-3.5 text-white placeholder-muted text-base focus:outline-none transition-colors"
                      onKeyDown={(e) => e.key === 'Enter' && handleRegStep1()}
                    />
                  </div>
                )}
                {error && <ErrorBox msg={error} />}
                <PrimaryBtn
                  onClick={emailMode === 'login' ? handleEmailLogin : handleRegStep1}
                  loading={loading}
                >
                  {emailMode === 'login' ? '登录' : '下一步：验证手机号 →'}
                </PrimaryBtn>
              </>
            )}

            {/* Step 2 — phone number (registration only) */}
            {regStep === 2 && (
              <>
                <div className="text-center pb-1">
                  <p className="text-white font-bold text-sm">最后一步</p>
                  <p className="text-slate text-xs mt-0.5">验证手机号以完成注册</p>
                </div>
                <PhoneInput value={regPhone} onChange={setRegPhone} onEnter={handleRegSendCode} />
                {error && <ErrorBox msg={error} />}
                <PrimaryBtn onClick={handleRegSendCode} loading={loading} disabled={regPhone.length < 10}>
                  发送验证码
                </PrimaryBtn>
                <BackBtn onClick={() => { setRegStep(1); setError('') }} label="← 返回修改信息" />
              </>
            )}

            {/* Step 3 — OTP (registration only) */}
            {regStep === 3 && (
              <>
                <SentTo phone={regPhone} />
                <OtpInput value={regCode} onChange={setRegCode} onEnter={handleRegVerify} />
                {error && <ErrorBox msg={error} />}
                <PrimaryBtn onClick={handleRegVerify} loading={loading} disabled={regCode.length < 6}>
                  验证并完成注册
                </PrimaryBtn>
                <ResendRow countdown={countdown} onResend={handleRegResend} loading={loading} />
                <BackBtn onClick={() => { setRegStep(2); setRegCode(''); setError('') }} label="← 更换手机号" />
              </>
            )}
          </div>
        )}

        {/* Google sign-in */}
        {!isWeChat && regStep === 1 && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-surface" />
              <span className="text-muted text-xs">或</span>
              <div className="flex-1 border-t border-surface" />
            </div>
            <button onClick={handleGoogleSignIn} disabled={loading}
              className="w-full bg-navy-light border border-surface hover:border-slate text-white
                         font-medium py-3.5 rounded-xl flex items-center justify-center gap-3
                         transition-all duration-150 disabled:opacity-40">
              <GoogleIcon />
              Continue with Google
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Small shared UI pieces ────────────────────────────────────────────────

function PhoneInput({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter?: () => void }) {
  return (
    <div>
      <label className="text-[10px] font-black text-slate uppercase tracking-widest block mb-2">手机号</label>
      <div className="flex rounded-xl overflow-hidden border border-surface focus-within:border-teal transition-colors">
        <span className="px-4 py-3.5 bg-surface text-slate font-mono text-base select-none shrink-0">+1</span>
        <input
          type="tel" inputMode="numeric" value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
          placeholder="2015550100" maxLength={10} autoFocus
          className="flex-1 px-4 py-3.5 bg-navy-light text-white placeholder-muted text-base focus:outline-none"
          onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        />
      </div>
      <p className="text-muted text-xs mt-1.5">输入10位美国手机号</p>
    </div>
  )
}

function SentTo({ phone }: { phone: string }) {
  return (
    <div className="text-center">
      <p className="text-slate text-sm">验证码已发送至</p>
      <p className="text-white font-bold">+1 {phone}</p>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/>
      <path fill="#34A853" d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96h-3.98v3.09C3.515 21.3 7.615 24 12.255 24z"/>
      <path fill="#FBBC05" d="M5.525 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62h-3.98a11.86 11.86 0 000 10.76l3.98-3.09z"/>
      <path fill="#EA4335" d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0c-4.64 0-8.74 2.7-10.71 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/>
    </svg>
  )
}
