# Who owns which files (parallel build)

| Area | Owner | Paths |
|---|---|---|
| Shared contracts | Lead (change only with a note here) | `shared/*`, `docs/API.md`, `server/src/db/Db.ts`, `server/src/auth-types.ts`, signatures in `server/src/services/access.ts` and `server/src/ai/contract.ts`, `client/src/lib/api.ts`, `client/src/lib/session.tsx`, `tailwind.config.js` |
| Data, API, permissions, seed, scripts | Agent 1 | `server/**` except `server/src/ai/**` and `server/src/routes/ai.ts`; `scripts/**`; `db/**`; `server/test/**` (non-AI) |
| Screens | Agent 2 | `client/**` except `client/src/features/piku/**` and `client/src/features/ai/**` |
| AI (Piku, suggestions, summaries, close-out AI) | Agent 3 | `server/src/ai/**`, `server/src/routes/ai.ts`, `client/src/features/piku/**`, `client/src/features/ai/**`, `server/test/ai*.test.ts` |
| End-to-end review | Agent 4 | `tests/e2e/**`, `playwright.config.ts`, fixes anywhere |
