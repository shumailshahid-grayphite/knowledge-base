# @kb/web

Next.js (App Router) frontend for the knowledge base. Tailwind + shadcn-style
components. Client-rendered, talks to `@kb/api` via a small typed fetch client;
JWT is stored in `localStorage`.

## Pages

| Route | Purpose |
|---|---|
| `/login` | Dev login (email only, needs `AUTH_DEV_MODE=true`) or password login. |
| `/` | Dashboard: space + document counts, space cards. |
| `/spaces` | List + create knowledge spaces. |
| `/spaces/[id]` | Upload documents; documents table with **live status polling**; reprocess. |
| `/spaces/[id]/ask` | Ask the space; grounded answer with **citations** (doc name, page, score). |
| `/settings` | Account info + sign out. |

## Run (dev)

```bash
# API + worker running first (see repo root README)
NEXT_PUBLIC_API_URL=http://localhost:4000 pnpm --filter @kb/web dev
# open http://localhost:3000
```

Types are shared from `@kb/shared` (DTOs), so request/response shapes stay in sync
with the API.
