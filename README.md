# Salary Gamification System

A modern, production-ready Next.js 14 application for gamifying sales team salary and performance tracking.

## 🏗️ Project Structure

```
salary-gamification/
├── frontend/          # Next.js 14 (TypeScript, Tailwind CSS)
├── backend/           # Express.js API (TypeScript)
├── shared/            # Shared types and constants
└── database/          # SQL schema
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL (Supabase)

### 1. Install Dependencies

```bash
cd salary-gamification
npm install
```

### 2. Setup Database

Run the SQL in `database/schema.sql` in your Supabase SQL Editor.

### 3. Configure Environment

Edit `backend/.env` with your database credentials.

#### Required server env vars (Render → web service → Environment, and `frontend/.env.local`)

| Variable | What it is | How to make one |
| --- | --- | --- |
| `JWT_SECRET` | Signs every login token. The app refuses to start without it, or if it is still the old public default. Changing it logs everyone out once. | `openssl rand -hex 32` |
| `VAULT_MASTER_KEY` | Encrypts each project's Env (`.env`) values **and CEO two-step sign-in secrets** (CEOs can't sign in without it). 32 bytes, base64. Keep a safe offline copy: if it is lost, stored values cannot be decrypted. Never commit it. | `openssl rand -base64 32` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used to sign upload/download links for project files. Never expose it to the browser. | Supabase → Project settings → API |
| `MEDIA_BUCKET` | Private Supabase Storage bucket for project files (default `project-media`). Create it as **private**, file size limit 50 MB. | Supabase → Storage → New bucket |
| `MEDIA_MAX_MB` | Upload size limit in MB (default 50). | — |
| `MEDIA_STORAGE` | `supabase` (default when the service key is set) or `local` (development only: files go to `frontend/.media-local`). | — |
| `SENDGRID_API_KEY` | Already used for agent emails; also sends notification emails and the daily digest. Optional: without it (or `NOTIFY_FROM_EMAIL`) only in-app notifications are sent. | SendGrid → API keys |
| `NOTIFY_FROM_EMAIL` / `NOTIFY_FROM_NAME` | Sender for notification emails (a verified SendGrid sender), e.g. `notifications@bytesplatform.com` / `Bytes Platform`. | — |
| `CEO_REQUIRE_2FA` | `true` makes CEO accounts use an authenticator app at login and for vault break-glass. **Off by default for now — turn it on before real use.** | — |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | Our org's GitHub App (creates project repos, adds/removes developers). Private key PEM; `\n` escapes are fine. App permissions: Administration write, Contents read, Pull requests read, Metadata read, Members write, Deployments read. | GitHub → Org settings → Developer settings → GitHub Apps |
| `GITHUB_ORG` | The organisation the App is installed on, e.g. `bytesplatform`. | — |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret; deliveries to `POST /api/github/webhook` (events: push, pull_request, create, deployment_status) are rejected without a matching signature. | `openssl rand -hex 32` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | The same App's OAuth credentials, for developers' "Connect GitHub" on their profile. Callback URL: `<APP_BASE_URL>/api/profile/github/callback`. | GitHub App settings |
| `APP_BASE_URL` | Public URL of the app, used for links in emails, e.g. `https://app.bytesplatform.com`. | — |

#### CEO / Executive accounts

- Run `database/migrations/create_ceo_role.sql` first (sessions, 2FA, CEO logs, privacy settings).
- Create the first CEO (prints a single-use 72-hour invite link; also emails it when SendGrid is set):
  `cd frontend && npx tsx scripts/create-ceo.ts <username> <email> "<Full Name>"` — needs `DB_*`, `APP_BASE_URL`, `VAULT_MASTER_KEY`.
  Further CEOs are added in the app (CEO accounts page, Admin mode).
- CEOs always sign in with a password **and** an authenticator code; sessions last 12 hours; a new device sends an email.
- A CEO can read everything; changes need **Admin mode** (password, 30 minutes, every change logged). "View as" is read-only.

### Tests

```bash
cd frontend && npm test                 # unit tests, no database needed
npm run test:integration                # real routes + SQL against a throwaway local Postgres — see tests/integration/README.md
```

### 4. Run Development Servers

```bash
# Run both frontend and backend
npm run dev

# Or run separately:
npm run dev:backend  # Starts on http://localhost:5000
npm run dev:frontend # Starts on http://localhost:3000
```

## 📁 Architecture

### Frontend (Next.js 14)
- **App Router** with route groups for auth and dashboard
- **Tailwind CSS** for styling
- **Custom hooks** for auth and data fetching
- **API Client** for backend communication

### Backend (Express.js)
- **RESTful API** with JWT authentication
- **PostgreSQL** connection via pg library
- **Service-based architecture**
- **Role-based access control** (HR/Agent)

### Database (Supabase PostgreSQL)
- `users` - User accounts with shifts and salaries
- `attendance` - Daily check-in/out records
- `daily_stats` - Call counts, talk time, leads
- `system_settings` - Global configuration

## 🔐 API Endpoints

### Auth
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Users
- `GET /api/users` - List all users (HR only)
- `GET /api/users/agents` - List agents
- `POST /api/users` - Create user (HR only)

### Attendance
- `GET /api/attendance/today` - Today's attendance
- `POST /api/attendance/check-in` - Check in
- `POST /api/attendance/check-out` - Check out
- `GET /api/attendance/pending` - Pending approvals (HR)

### Stats
- `GET /api/stats/dashboard` - Agent dashboard data
- `GET /api/stats/leaderboard` - Today's leaderboard
- `POST /api/stats/sync` - Sync from call_logs

## 👤 Default Users

| Username | Role | Extension | Password |
|----------|------|-----------|----------|
| hr_admin | HR | 999 | (set in SQL) |
| ali | Agent | 101 | (set in SQL) |

## 🎯 Features

- ✅ Real-time salary calculation
- ✅ Attendance tracking (check-in/out)
- ✅ 3CX call stats integration
- ✅ Daily & monthly leaderboards
- ✅ HR approval workflow
- ✅ Mid-month start proration
- ✅ Night shift support
- ✅ Mobile responsive UI
