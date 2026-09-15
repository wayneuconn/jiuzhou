export type UserRole = 'admin' | 'member' | 'guest'
export type MembershipType = 'annual' | 'per_session' | 'none'
export type CardTier = 'blue' | 'gold' | 'silver' | 'bronze' | 'none'

export interface CardThresholds {
  bronze: number
  silver: number
  gold: number
  blue: number
}

export interface User {
  uid: string
  openid?: string
  displayName: string
  phone: string
  avatar?: string
  preferredPositions: string[]
  // 月-日 only, no year: enough for the team's purpose, and a much weaker
  // identifier than a full date under 最小必要. Must stay declared in the
  // mini program's 用户隐私保护指引.
  birthday?: string
  role: UserRole
  membershipType: MembershipType
  // Which season this 年卡 was granted for. Rollover downgrades any annual
  // whose season no longer matches config.season — so an absent field means
  // "granted before seasons were tracked" and rolls over like any other.
  annualSeason?: string
  attendanceCount: number
  // Current tally — drives the GK rule and is zeroed once served
  lateCount: number
  // Lifetime tally — never cleared, carries across seasons
  lateCountTotal: number
  dangerousCount: number
  // Lifetime 旷赛 tally — never cleared
  absentCount: number
  // Halves of GK duty still owed for 旷赛. Paid off in goal, one half at a
  // time: 2 owed can be served as one full match or across two matches.
  gkHalvesOwed: number
  // Manual admin sanction only — 旷赛 no longer bans anyone
  banGamesLeft: number
  createdAt: number
}

export type PaymentEventType = 'member' | 'event'
export type PaymentEventStatus = 'open' | 'closed'
export type PaymentStatus = 'pending' | 'confirmed'

export interface PaymentEvent {
  id: string
  title: string
  type: PaymentEventType
  annualAmount: number
  perSessionAmount: number
  status: PaymentEventStatus
  createdAt: number
}

export interface Payment {
  id: string
  uid: string
  displayName: string
  membershipType: MembershipType
  amount: number
  status: PaymentStatus
  paidAt: number
  confirmedAt?: number
  confirmedBy?: string
}

export type MatchStatus =
  | 'draft'
  | 'registration_r1'
  | 'registration_r2'
  | 'drafting'
  | 'ready'
  | 'completed'
  | 'cancelled'

export interface DraftState {
  currentTurn: 'A' | 'B' | null
  pickOrder: ('A' | 'B')[]
  pickIndex: number
}

export interface Match {
  id: string
  date: number
  location: string
  maxPlayers: number
  status: MatchStatus
  autoReady?: boolean
  // true only after the kickoff-1h cron lock — a manual 选人结束 leaves it false
  rosterLocked?: boolean
  round2Link?: string
  captainA?: string | null
  captainB?: string | null
  draftState?: DraftState
  draftNudge?: { to: 'A' | 'B'; from: 'A' | 'B'; at: number } | null
  agreementText: string
  scoreA?: number | null
  scoreB?: number | null
  // true once someone typed a score by hand — stops the goal tallies from
  // overwriting it
  scoreManual?: boolean
  // 娱乐局: score isn't shown and the match is left out of the captain board
  casual?: boolean
  createdAt: number
}

export type RegistrationStatus = 'confirmed' | 'waitlist' | 'promoted' | 'withdrawn' | 'excused'
export type PaymentSessionStatus = 'pending' | 'confirmed'
export type MatchTag = 'late' | 'dangerous' | 'absent'

export interface Registration {
  uid: string
  displayName: string
  preferredPositions?: string[]
  registeredAt: number
  status: RegistrationStatus
  waitlistPosition?: number | null
  promotedAt?: number | null
  confirmDeadline?: number | null
  autoAccept?: boolean
  team?: 'A' | 'B' | null
  paymentStatus?: PaymentSessionStatus | null
  tags?: MatchTag[]
  goals?: number
  assists?: number
  // Carries a GK duty this match: either the 迟到 threshold was crossed or
  // there's 旷赛 debt outstanding. Serving it settles the matching tally.
  gkPenalty?: boolean
  // Halves this match's duty covers: 1 = 半场, 2 = 全场 (chosen at signup)
  gkHalves?: number
  // Which tally the duty answers to
  gkReason?: 'late' | 'absent'
  // Attached by a retroactive tag rather than claimed at signup — the player
  // never got to pick 全场, so the UI says 安排 rather than 认领, and undoing
  // the tag takes back only duties carrying this flag
  gkAuto?: boolean
  // Halves a captain/admin confirmed were actually served
  gkHalvesServed?: number
  // Waitlist priority: 1 = annual self, 2 = friend brought by annual, 3 = per_session/other
  waitlistTier?: number
  // Guest (friend) registrations added by an annual member
  isGuest?: boolean
  broughtBy?: string | null
  broughtByName?: string | null
}

export interface PlayerPosition {
  x: number
  y: number
}

export interface Formation {
  captainUid: string
  positions: Record<string, PlayerPosition>
  updatedAt: number
}

// ── One-off events (周年庆/聚餐/团建): optional polling phase, then signup ──
export type EventStatus = 'draft' | 'polling' | 'registration' | 'closed' | 'cancelled'
export type EventScope = 'annual' | 'member' | 'all'
export type EventQuestionType = 'single' | 'multi' | 'text'

export interface EventQuestion {
  id: string
  title: string
  type: EventQuestionType
  options: string[]
  required: boolean
}

export interface TeamEvent {
  id: string
  title: string
  description: string
  location: string
  eventDate: number | null
  deadline: number | null
  scope: EventScope
  allowGuests: boolean
  maxGuestsPer: number
  maxAttendees: number | null
  pollQuestions: EventQuestion[]
  signupQuestions: EventQuestion[]
  status: EventStatus
  createdAt: number
}

export type EventRegStatus = 'polled' | 'confirmed' | 'withdrawn'

export interface EventReg {
  eventId: string
  uid: string
  displayName: string
  status: EventRegStatus
  guests: number
  guestNames: string
  pollAnswers: Record<string, string | string[]>
  signupAnswers: Record<string, string | string[]>
  registeredAt: number
}

export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface MembershipApplication {
  id: string
  uid: string
  displayName: string
  realName: string
  note: string
  requestedType: MembershipType
  currentType: MembershipType
  attendanceCount: number
  status: ApplicationStatus
  createdAt: number
  decidedBy?: string | null
  decidedAt?: number | null
  rejectReason?: string | null
}

// ── 赛季年卡登记：年卡按赛季生效，换季时未登记的降为次卡 ──────────────────
export type SeasonDriveStatus = 'open' | 'closed'

export interface SeasonDrive {
  season: string
  status: SeasonDriveStatus
  deadline: number | null
  note: string
  openedAt: number
  closedAt?: number | null
  rolledOverAt?: number | null
}

// What the player said, and whether an admin has confirmed it. Two-phase like
// membership applications: the handshake happens outside the app.
export type RenewalResponse = 'continue' | 'decline'
export type RenewalStatus = 'pending' | 'confirmed' | 'rejected'

export interface SeasonRenewal {
  id: string
  season: string
  uid: string
  displayName: string
  response: RenewalResponse
  // Collected on 确认继续 (MM-DD)
  birthday?: string | null
  note: string
  status: RenewalStatus
  respondedAt: number
  decidedBy?: string | null
  decidedAt?: number | null
}

// ── 邀请：一码一人，用掉即成次卡；年卡仍需另行申请审批 ────────────────────
export type InviteStatus = 'open' | 'used' | 'revoked'

export interface Invite {
  code: string
  note: string
  createdBy: string
  createdByName: string
  createdAt: number
  expiresAt: number | null
  status: InviteStatus
  usedBy?: string | null
  usedByName?: string | null
  usedAt?: number | null
}

export interface Announcement {
  id: string
  title: string
  content: string
  pinned: boolean
  // Pops up on the match page when opened; popupUntil null = no expiry
  popup?: boolean
  popupUntil?: number | null
  createdAt: number
  updatedAt: number
}

export interface AppConfig {
  season: string
  cardThresholds: CardThresholds
  waitlistConfirmMinutes: number
  // Late-arrival threshold: at this many 迟到, the player must play GK next
  // match. 0 disables the rule.
  lateThreshold: number
  // 旷赛 penalty, in halves of GK duty (2 = one full match). 0 disables it.
  absentGkHalves: number
  defaultAgreementText: string
  defaultAnnouncement: string
  perSessionFee: number
  autoRecurring: boolean
  recurringDays: number[]
  recurringHour: number
  recurringMinute: number
  recurringLocation: string
  recurringMaxPlayers: number
  winterBreakStart: string
  winterBreakEnd: string
}
