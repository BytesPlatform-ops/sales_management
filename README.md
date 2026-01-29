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
