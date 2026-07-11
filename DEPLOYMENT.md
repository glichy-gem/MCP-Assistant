# ServiceNow MCP Chat Assistant — Deployment Guide

## Overview
This is a full-stack application:
- **Frontend**: React 18 + TypeScript (built as static files)
- **Backend**: Python 3.11 + FastAPI
- **Database**: PostgreSQL (you're using Neon ✓)
- **LLM**: Groq (free tier)

---

## Recommended Deployment Architecture

### Option 1: Railway.app (Easiest for beginners)
**Pros**: One-click deploy, handles both frontend and backend, free tier available
**Cost**: $5/month + usage

1. **Push your repo to GitHub** (already done ✓)
2. **Sign up at railway.app**
3. **Create new project → GitHub → select your repo**
4. **Add variables** in Railway dashboard:
   ```
   POSTGRES_HOST = your-neon-db-host
   POSTGRES_USER = neondb_owner
   POSTGRES_PASSWORD = your-password
   POSTGRES_DB = neondb
   POSTGRES_PORT = 5432
   POSTGRES_SSLMODE = require
   
   GROQ_API_KEY = your-groq-key
   GROQ_MODEL = llama-3.3-70b-versatile
   
   ADMIN_USER = admin
   ADMIN_PASSWORD = strong-password
   
   GOOGLE_CLIENT_ID = (optional, leave empty for local auth only)
   GOOGLE_CLIENT_SECRET = (optional)
   GOOGLE_REDIRECT_URI = https://your-domain.railway.app/api/auth/google/callback
   ```
5. **Create Procfile** in repo root:
   ```
   build: cd frontend && npm install && npm run build
   web: uvicorn app:app --app-dir backend --host 0.0.0.0 --port $PORT
   ```
6. **Deploy** — Railway auto-deploys on push

---

### Option 2: Vercel (Frontend) + Render (Backend)
**Pros**: Industry standard, better performance
**Cost**: Vercel free tier + Render ~$7/month

#### Frontend on Vercel:
1. **Build locally**: `cd frontend && npm run build`
2. **Push repo to GitHub**
3. **Sign up vercel.com → Import repo**
4. **Set build command**: `cd frontend && npm run build`
5. **Set output directory**: `frontend/dist`
6. **Deploy** ✓

#### Backend on Render:
1. **Sign up render.com → New Web Service**
2. **Connect your GitHub repo**
3. **Set build command**: `pip install -r requirements.txt && pip install -r mcp/requirements.txt`
4. **Set start command**: `uvicorn app:app --app-dir backend --host 0.0.0.0 --port $PORT`
5. **Add environment variables** (same as above)
6. **Bind to port**: `$PORT`
7. **Deploy** ✓
8. **Update frontend .env** to point to Render backend URL

---

### Option 3: Docker + Any Cloud (AWS/GCP/DigitalOcean/Linode)
**Pros**: Full control, scalable
**Cost**: $5-15/month

#### Create Dockerfile:
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Backend deps
COPY mcp/requirements.txt mcp/requirements.txt
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r mcp/requirements.txt && pip install -r backend/requirements.txt

# Frontend
RUN apt-get update && apt-get install -y nodejs npm
COPY frontend frontend
RUN cd frontend && npm install && npm run build

# Copy source
COPY backend backend
COPY mcp mcp

EXPOSE 8000
CMD ["uvicorn", "app:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
```

#### Deploy to DigitalOcean/Linode/Heroku:
1. **Build image**: `docker build -t servicenow-mcp .`
2. **Push to Docker Hub** or container registry
3. **Deploy** to DigitalOcean App Platform / Heroku / AWS ECS
4. **Set environment variables** in platform dashboard

---

## Environment Variables Checklist

### Required:
```
POSTGRES_HOST
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
POSTGRES_PORT = 5432
POSTGRES_SSLMODE = require

GROQ_API_KEY
GROQ_MODEL = llama-3.3-70b-versatile

ADMIN_USER = admin
ADMIN_PASSWORD = strong-random-password
SESSION_SECRET = auto-generated (leave empty to auto-generate)
```

### Optional (Google OIDC):
```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI = https://your-domain/api/auth/google/callback
```

---

## Step-by-Step: Railway Deployment (Recommended for you)

### 1. Prepare repo
```bash
git add .
git commit -m "chore: add Procfile for deployment"
git push
```

### 2. Create Procfile
```bash
echo 'build: cd frontend && npm install && npm run build
web: uvicorn app:app --app-dir backend --host 0.0.0.0 --port $PORT' > Procfile
git add Procfile
git commit -m "chore: add Procfile for Railway deployment"
git push
```

### 3. Go to railway.app
- Sign up (free account)
- Create new project
- Select "GitHub repo"
- Choose your MCP-Assistant repo
- Click "Deploy"

### 4. Add environment variables in Railway
Dashboard → Project → Variables → Add:
```
POSTGRES_HOST=your-neon-db-host.neon.tech
POSTGRES_PORT=5432
POSTGRES_USER=neondb_owner
POSTGRES_PASSWORD=your-neon-password
POSTGRES_DB=neondb
POSTGRES_SSLMODE=require

GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile

ADMIN_USER=admin
ADMIN_PASSWORD=strong-password-here

GOOGLE_REDIRECT_URI=https://your-railway-domain.up.railway.app/api/auth/google/callback
```

**Get values from:**
- Neon DB: https://console.neon.tech → your-project → Connection string
- Groq API: https://console.groq.com → API Keys

### 5. Deploy
- Railway auto-deploys on push
- Watch logs in dashboard
- Get URL: `https://your-railway-domain.up.railway.app`

---

## Domain Setup (Optional but Recommended)

### Add custom domain:
1. **Buy domain** from GoDaddy/Namecheap/Cloudflare
2. **Point to your deployment**:
   - Railway: Add domain in project settings
   - Vercel: Add domain in project settings
   - Render: Add domain in service settings
3. **Enable HTTPS** (all platforms auto-provide free SSL)
4. **Update GOOGLE_REDIRECT_URI** if using Google auth:
   ```
   https://your-domain.com/api/auth/google/callback
   ```

---

## Post-Deployment Checklist

- [ ] Frontend loads at your domain
- [ ] Can log in with admin credentials
- [ ] MCP servers are registered and show green/connected
- [ ] Chat works (test with a simple message)
- [ ] Tools load and can be called
- [ ] Admin page loads, users can be managed
- [ ] Settings page shows correct LLM (Groq only)
- [ ] Database is persisting data (create test user)

---

## Monitoring & Maintenance

### View logs:
- **Railway**: Dashboard → Deployments → Logs
- **Render**: Dashboard → Service → Logs
- **Vercel**: Dashboard → Deployments → Logs

### Common issues:
| Issue | Fix |
|---|---|
| "502 Bad Gateway" | Check backend logs, verify Postgres connection |
| "Cannot connect to Groq" | Check `GROQ_API_KEY` is valid and in env |
| "Database connection failed" | Verify `POSTGRES_*` vars, check Neon status |
| "Styles not loading" | Frontend build failed — check build logs |

---

## Scaling (When needed)

- **More users**: Upgrade Neon Postgres plan
- **Higher LLM throughput**: Switch to Groq paid tier
- **More concurrent requests**: Upgrade Railway/Render plan
- **CDN for frontend**: Add Cloudflare in front

---

## Security Checklist

Before going live:
- [ ] Change `ADMIN_PASSWORD` to something strong
- [ ] Set `GROQ_API_KEY` to a new key (rotate old one)
- [ ] Set `SESSION_SECRET` to a random string or let app auto-generate
- [ ] Use HTTPS (all platforms provide free SSL)
- [ ] Disable public signups in backend/.env or via UI (optional)
- [ ] Regularly audit user roles and tool grants
- [ ] Enable Google OIDC if you want SSO

---

## Which option to pick?

| Platform | Best for | Setup time | Cost | Recommendation |
|---|---|---|---|---|
| **Railway** | All-in-one simplicity | 15 min | $5-10/mo | ⭐ Start here |
| **Vercel + Render** | High performance | 30 min | Free-15/mo | When you need scale |
| **Docker + VPS** | Full control | 1 hour | $5-20/mo | When you need customization |

---

## Questions?

If you hit issues during deployment, check:
1. Environment variables are set correctly
2. Postgres is accessible (Neon might rate-limit)
3. Groq API key is valid
4. Frontend build succeeded
5. Backend is listening on correct port

Good luck! 🚀
