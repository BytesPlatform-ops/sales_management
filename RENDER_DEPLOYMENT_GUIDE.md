# 🚀 Render Deployment Guide - Salary System

This guide walks you through deploying both the **Frontend (Next.js)** and **Backend (Express.js)** on Render.

---

## 📋 Prerequisites

1. A [Render](https://render.com) account (free tier available)
2. Your code pushed to a GitHub repository
3. Your Supabase database credentials (already configured)

---

## 🗂️ Project Structure

```
salary-gamification/
├── frontend/          # Next.js 14 App
├── backend/           # Express.js API
├── database/          # SQL migrations
└── shared/            # Shared types
```

---

## Step 1: Push Code to GitHub

If not already done:

```bash
cd /Users/bytes/Desktop/3cx/salary-gamification

# Initialize git (if not done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit for Render deployment"

# Add your GitHub remote
git remote add origin https://github.com/YOUR_USERNAME/salary-gamification.git

# Push
git push -u origin main
```

---

## Step 2: Deploy the Backend (Express.js)

### 2.1 Create Backend Web Service

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure the service:

| Setting | Value |
|---------|-------|
| **Name** | `salary-backend` |
| **Region** | Singapore (Southeast Asia) or closest to you |
| **Branch** | `main` |
| **Root Directory** | `backend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | Free (or Starter $7/mo for better performance) |

### 2.2 Add Backend Environment Variables

Click **"Environment"** tab and add these variables:

| Key | Value | Description |
|-----|-------|-------------|
| `NODE_ENV` | `production` | Production mode |
| `PORT` | `10000` | Render uses port 10000 |
| `DB_HOST` | `aws-1-ap-southeast-2.pooler.supabase.com` | Supabase host |
| `DB_PORT` | `6543` | Supabase pooler port |
| `DB_NAME` | `postgres` | Database name |
| `DB_USER` | `postgres.wcwaslfuvuboexuldtzy` | Your Supabase user |
| `DB_PASSWORD` | `!Bytes!0712` | Your Supabase password |
| `JWT_SECRET` | `your-super-secure-random-string-here-32chars` | Generate a strong secret |
| `JWT_EXPIRES_IN` | `7d` | Token expiry |
| `FRONTEND_URL` | `https://salary-frontend.onrender.com` | Your frontend URL (update after creating) |

> ⚠️ **Generate a strong JWT_SECRET**: Run this in terminal:
> ```bash
> openssl rand -base64 32
> ```

### 2.3 Click "Create Web Service"

Wait for the build to complete. Note your backend URL:
```
https://salary-backend.onrender.com
```

---

## Step 3: Deploy the Frontend (Next.js)

### 3.1 Create Frontend Web Service

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Connect the same GitHub repository
4. Configure the service:

| Setting | Value |
|---------|-------|
| **Name** | `salary-frontend` |
| **Region** | Same as backend |
| **Branch** | `main` |
| **Root Directory** | `frontend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | Free (or Starter $7/mo) |

### 3.2 Add Frontend Environment Variables

| Key | Value | Description |
|-----|-------|-------------|
| `NODE_ENV` | `production` | Production mode |
| `DB_HOST` | `aws-1-ap-southeast-2.pooler.supabase.com` | Supabase host |
| `DB_PORT` | `6543` | Supabase pooler port |
| `DB_NAME` | `postgres` | Database name |
| `DB_USER` | `postgres.wcwaslfuvuboexuldtzy` | Your Supabase user |
| `DB_PASSWORD` | `!Bytes!0712` | Your Supabase password |
| `JWT_SECRET` | `same-as-backend-jwt-secret` | **MUST match backend** |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://wcwaslfuvuboexuldtzy.supabase.co` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `your-supabase-anon-key` | From Supabase dashboard |
| `NEXT_PUBLIC_API_URL` | `https://salary-backend.onrender.com` | Your backend URL |

### 3.3 Click "Create Web Service"

Wait for build to complete. Your frontend URL:
```
https://salary-frontend.onrender.com
```

---

## Step 4: Update CORS Settings

After both services are deployed, update the backend's `FRONTEND_URL` environment variable with the actual frontend URL.

Go to Backend service → Environment → Update:
```
FRONTEND_URL=https://salary-frontend.onrender.com
```

---

## Step 5: Run Database Migrations (If Needed)

Your database is already on Supabase, but if you need to run migrations:

1. Go to Supabase Dashboard → SQL Editor
2. Run the migrations from `database/` folder:
   - `schema.sql` (main schema)
   - `migrations/create_payments_table.sql` (payments table)

---

## 📁 Required File Updates Before Deployment

### Update `backend/src/app.ts` - Add CORS

Make sure your backend has proper CORS configuration:

```typescript
import cors from 'cors';

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
```

### Update `frontend/lib/db.ts` - Use Environment Variables

The file should use environment variables (already configured):

```typescript
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '6543', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});
```

---

## 🔒 Security Checklist

- [ ] Generate unique `JWT_SECRET` (don't use default)
- [ ] Use same `JWT_SECRET` for both frontend and backend
- [ ] Database password is set via environment variable
- [ ] SSL is enabled for database connections
- [ ] CORS is configured to only allow your frontend

---

## 🌐 Final URLs

After deployment:

| Service | URL |
|---------|-----|
| **Frontend** | `https://salary-frontend.onrender.com` |
| **Backend** | `https://salary-backend.onrender.com` |
| **Login Page** | `https://salary-frontend.onrender.com/login` |

---

## 🐛 Troubleshooting

### Build Fails

1. Check the build logs in Render dashboard
2. Ensure `package.json` has correct build scripts
3. Verify all dependencies are listed

### Database Connection Error

1. Verify Supabase credentials in environment variables
2. Check if Supabase allows connections from Render IPs
3. Ensure SSL is enabled: `ssl: { rejectUnauthorized: false }`

### CORS Errors

1. Update `FRONTEND_URL` in backend environment
2. Ensure CORS middleware is configured
3. Check browser console for exact error

### 502 Bad Gateway

1. Check if start command is correct
2. Verify the app listens on `process.env.PORT`
3. Check Render logs for errors

### Slow Cold Starts (Free Tier)

Free tier services sleep after 15 mins of inactivity. First request may take 30-60 seconds. Upgrade to Starter ($7/mo) for always-on.

---

## 📝 Environment Variables Summary

### Backend (`salary-backend`)

```env
NODE_ENV=production
PORT=10000
DB_HOST=aws-1-ap-southeast-2.pooler.supabase.com
DB_PORT=6543
DB_NAME=postgres
DB_USER=postgres.wcwaslfuvuboexuldtzy
DB_PASSWORD=!Bytes!0712
JWT_SECRET=<generate-strong-secret>
JWT_EXPIRES_IN=7d
FRONTEND_URL=https://salary-frontend.onrender.com
```

### Frontend (`salary-frontend`)

```env
NODE_ENV=production
DB_HOST=aws-1-ap-southeast-2.pooler.supabase.com
DB_PORT=6543
DB_NAME=postgres
DB_USER=postgres.wcwaslfuvuboexuldtzy
DB_PASSWORD=!Bytes!0712
JWT_SECRET=<same-as-backend>
NEXT_PUBLIC_SUPABASE_URL=https://wcwaslfuvuboexuldtzy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key-from-supabase>
NEXT_PUBLIC_API_URL=https://salary-backend.onrender.com
```

---

## 🎉 Done!

Your Salary System is now deployed on Render!

**Test Users:**
- HR Admin: `hr_admin` (any password)
- Agent: `ali` (any password)

---

## 💡 Tips

1. **Custom Domain**: Add custom domain in Render settings → Custom Domains
2. **Auto Deploy**: Enable automatic deploys on push to main branch
3. **Monitoring**: Use Render's built-in metrics and logs
4. **Scaling**: Upgrade to paid tier for better performance and no cold starts
