# 九州 — Football Team Management

Mobile-first web app for managing a recreational football team (~30–50 players). Shared via WeChat link — no app download needed.

**Live:** https://jiuzhou-493217.web.app

---

## Tech Stack

| Layer | Choice |
|---|---|
| UI | React 18 + TypeScript, Vite 5 |
| Styling | Tailwind CSS v3 (PostCSS) |
| Routing | React Router v7 |
| State | Zustand (`authStore`) |
| Backend | Firebase — Auth, Firestore, Storage, Hosting |
| CI/CD | GitHub Actions → Firebase Hosting |

No traditional backend. Firestore Security Rules are the authorization layer. Cloud Functions reserved for atomic operations (waitlist promotion timeouts, invite links).

---

## Architecture

```
src/
├── components/
│   ├── layout/          # AppLayout, BottomTabBar, ProtectedRoute
│   ├── Pitch.tsx        # Drag-and-drop tactical board (reusable, any Firestore ref)
│   └── PlayerCard.tsx   # MiniCard with tier ring + position badge
├── pages/
│   ├── LoginPage.tsx
│   ├── HomePage.tsx          # Announcements feed
│   ├── MatchesPage.tsx       # Match list
│   ├── MatchDetailPage.tsx   # Registration, draft, tactics, excused list
│   ├── TacticsPage.tsx       # Global tactics board (falls back to active match)
│   ├── ProfilePage.tsx
│   ├── onboard/              # BindPhonePage, SetupProfilePage
│   └── admin/                # Dashboard, Matches, Members, Payments, Settings
├── stores/
│   └── authStore.ts          # Zustand: firebaseUser + userProfile
├── lib/
│   └── firebase.ts           # Firebase app init
├── utils/
│   └── cardTier.ts           # Attendance → card tier (bronze/silver/gold/blue)
└── types/
    └── index.ts              # All shared TypeScript types
```

---

## Firestore Data Model

```
users/{uid}
  displayName, phone, avatar?, preferredPositions[], role, membershipType, attendanceCount, createdAt

matches/{matchId}
  date, location, maxPlayers, status, captainA?, captainB?, agreementText, draftState?, createdAt
  └── registrations/{uid}
        displayName, preferredPositions[], registeredAt, status, waitlistPosition?,
        promotedAt?, confirmDeadline?, autoAccept, team?
  └── formations/{formationId}        # board | teamA | teamB
        captainUid, positions: { uid: { x, y } }, updatedAt

paymentEvents/{eventId}
  title, type, annualAmount, perSessionAmount, venmoHandle, status, createdAt
  └── payments/{uid}
        displayName, membershipType, amount, status, paidAt, confirmedAt?, confirmedBy?

announcements/{id}      title, content, pinned, createdAt, updatedAt
config/appConfig        season, cardThresholds, waitlistConfirmMinutes, defaultAgreementText
inviteTokens/{tokenId}  (admin-only write)
tactics/default         global fallback tactics board
```

---

## Auth & Roles

- **Login:** Phone/SMS OTP (primary) + Google Sign-In (secondary — hidden inside WeChat)
- Phone cached in `localStorage` as `jz_phone` for fast re-login

| Role | Permissions |
|---|---|
| `admin` | Full access; exempt from membership requirements; shown as 年卡 by default |
| `member` | Annual membership (`annual`) — R1 + R2 registration |
| `guest` | Per-session (`per_session`) or none — R2 only |

---

## Match Status Flow

```
draft → registration_r1 → registration_r2 → drafting → ready → completed
```

| Status | What's open |
|---|---|
| `registration_r1` | Annual members + admin can register |
| `registration_r2` | All members can register |
| `drafting` | Captains pick teams; per-team tactics boards visible to each team only |
| `ready` | Match is set; formations locked |
| `completed` | Archived |

---

## Registration Status Flow

```
waitlist → promoted → confirmed
                 ↘ (timeout/decline) → next waitlist person promoted
confirmed → excused  (gives up spot, auto-promotes next waitlist)
any → withdrawn
```

- **Auto-promote:** triggered when a confirmed or excused player frees their spot
- **autoAccept:** if set, the promoted player is instantly confirmed (no 30-min window)
- **Excused (请假):** confirmed player requests leave; spot is released; shown in 请假 section

---

## Card Tiers (Attendance)

| Tier | Color | Default threshold |
|---|---|---|
| Bronze | `#B87333` | 1+ sessions |
| Silver | `#A8A9AD` | 10+ sessions |
| Gold | `#F0B429` | 25+ sessions |
| Blue | `#4F90E1` | 50+ sessions |

Thresholds are configurable in Admin → Settings (`config/appConfig.cardThresholds`).

---

## Local Development

```bash
cp .env.example .env      # fill in Firebase config
npm install
npm run dev
```

Deploy (manual):
```bash
npm run build
firebase deploy --only hosting
```

CI/CD: every push to `main` triggers `.github/workflows/deploy.yml` — type-checks, builds, and deploys to Firebase Hosting live channel automatically.

---

## Environment Variables

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

GitHub Actions reads these from repository Secrets. Firebase service account stored as `FIREBASE_SERVICE_ACCOUNT_JIUZHOU`.
