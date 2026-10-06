# CardClash — Production Deployment Guide (`docs/DEPLOYMENT.md`)

This guide covers deploying CardClash across Docker, Vercel, Fly.io, and Railway with persistent PostgreSQL and Redis.

---

## 1. Environment Variables Overview

| Variable | Description | Required / Default |
|---|---|---|
| `PORT` | Web and server port | Defaults to `3000` |
| `NEXT_PUBLIC_SOCKET_URL` | Optional custom Socket.IO URL | Defaults to window.location.origin |
| `SESSION_SECRET` | HMAC-SHA256 secret for session tokens | Strong random 32+ char secret |
| `AUTH_SECRET` | Auth.js account session secret | Strong random secret |
| `DATABASE_URL` | PostgreSQL connection string | Defaults to in-memory store if unset |
| `REDIS_URL` | Redis connection URL | Defaults to in-memory store if unset |

---

## 2. Docker & Docker Compose (Recommended Self-Hosted)

Run full-stack CardClash with integrated Redis and PostgreSQL:

```bash
# 1. Clone repository and start containers
docker compose up --build -d

# 2. Check health status
docker compose ps

# 3. Access web application
open http://localhost:3000
```

---

## 3. Split Cloud Deployment: Vercel (Web) + Fly.io / Railway (Server)

### A. Deploying Server on Fly.io / Railway (`apps/server`)

CardClash backend requires a persistent Node.js process supporting WebSockets.

1. **Deploy on Fly.io**:
   ```bash
   fly launch --name cardclash-server --dockerfile Dockerfile
   fly secrets set SESSION_SECRET="..." AUTH_SECRET="..."
   fly redis create
   fly pg create
   fly deploy
   ```

2. **Deploy on Railway**:
   - Create new Railway project from GitHub repo.
   - Add **Redis** and **PostgreSQL** plugins.
   - Configure Start Command: `node server.ts` or `npm start`.

### B. Deploying Frontend on Vercel (`apps/web`)

1. Connect GitHub repo in Vercel Dashboard.
2. Set Environment Variable:
   - `NEXT_PUBLIC_SOCKET_URL`: `https://cardclash-server.fly.dev` (your server URL).
   - `SESSION_SECRET`: matching server HMAC secret.
3. Deploy!

---

## 4. Progressive Web App (PWA) Verification

CardClash is a standards-compliant PWA:
- Valid `app/manifest.ts` declaring standalone display, theme colors, and icons.
- In-app install banner handling `beforeinstallprompt` on Chrome/Android and guided step-by-step instructions on iOS Safari.
- Offline banner informing players when connection is lost.

---

## 5. Load Testing with Artillery

Simulate 1,000 concurrent rooms:

```bash
# Run Artillery load test
npx artillery run tests/artillery/cardclash-load-test.yml

# Or run the TypeScript engine stress benchmark
npx tsx apps/server/tests/load-test-benchmark.ts
```
