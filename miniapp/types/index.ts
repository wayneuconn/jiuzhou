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
  role: UserRole
  membershipType: MembershipType
  attendanceCount: number
  lateCount: number
  dangerousCount: number
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
  // Registered while at/over the late threshold — must play GK this match;
  // completing it clears their 迟到 tally.
  gkPenalty?: boolean
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
