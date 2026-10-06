# Automatic Persistent Backend Fallback Plan

Configure the client-side socket.io client and session API fetches to automatically fall back to our persistent, high-performance Google Cloud Run backend URL when the environment variable `NEXT_PUBLIC_SOCKET_URL` is undefined, ensuring Vercel deployments work out-of-the-box.

## User Review & Critical Decisions

> [!IMPORTANT]
> The user confirmed the following preferences in Phase 1:
> - **Architecture**: Run split cloud setup with frontend on Vercel and stateful backend on our persistent Google Cloud Run container.
> - **Automatic Fallback**: Configure the frontend client code to automatically connect to `https://ais-pre-edxfqef7v2eiu27e45gevo-89927942959.europe-west3.run.app` as a smart fallback whenever `NEXT_PUBLIC_SOCKET_URL` is undefined, allowing their Vercel deployment to succeed instantly without manual configuration.

- **Confirmed Choice 1**: Split deployment (Vercel Client + Google Cloud Run Backend).
- **Confirmed Choice 2**: Automatic fallback to our high-performance Cloud Run backend on custom domains (like Vercel).

---

## 1. Overview & Core Concept

Vercel is a serverless platform that does not support long-running, stateful TCP WebSocket connections (Socket.IO) or memory-based room managers. 

By default, the client-side code attempts to connect to the current domain (`window.location.origin`), which fails on Vercel because Vercel serverless routes cannot run the stateful `server.ts` process.

This change configures the client application to dynamically detect if it is running on a custom domain (like `uno-drab-chi.vercel.app`) and automatically fall back to our already persistent Google Cloud Run server URL `https://ais-pre-edxfqef7v2eiu27e45gevo-89927942959.europe-west3.run.app` for both WebSocket connections and session API requests.

---

## 2. Technical Architecture & Data Strategy

### Dynamic Base URL Resolver
We will implement a helper function `getBackendUrl()` that:
1. Returns `NEXT_PUBLIC_SOCKET_URL` if explicitly defined.
2. Returns the persistent Cloud Run URL `https://ais-pre-edxfqef7v2eiu27e45gevo-89927942959.europe-west3.run.app` if running on a custom domain (like `*.vercel.app` or any domain that is not `localhost` or our custom Run.app subdomain).
3. Defaults to `window.location.origin` for local development.

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Frontend                       │
│               (e.g., uno-drab-chi.vercel.app)               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Fetch Session Creds ──► POST https://ais-pre-...run.app/   │
│                                                             │
│  Socket Connection  ──► io("https://ais-pre-...run.app")    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Component Updates
- `components/cardclash-app.tsx`:
  - Implement `getBackendUrl()` dynamic resolver.
  - Update `fetchGuestToken` and `fetchAccountToken` to point to the resolved backend URL for API fetches.
  - Update `io(...)` initialization to use the resolved backend URL.
