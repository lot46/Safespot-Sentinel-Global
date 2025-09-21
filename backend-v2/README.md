# SafeSpot Sentinel Global V2 (backend-v2)

## Phase 3 → 4 Runbook (Mocked DB for Tests)

- Tests run with Prisma mocked (no external DB/Redis needed)
- Env examples: see .env.example
- Commands:
  - yarn test (runs jest with ESM preset)
  - yarn test:moderation (moderation unit tests)

## Endpoints Overview

- Auth: /api/auth (register, login, refresh, rotate, logout, 2FA, csrf)
- Reports: /api/reports (AI moderation, persist aiModeration)
- SOS: /api/sos (start, heartbeat, end, sessions, status)
- Admin: /api/admin (dashboard, notify/test)
- Payments (Phase 4 scaffold): /api/payments (intent, get by id)
- Health: /api/health; Metrics: /metrics
- WebSocket (Phase 4 scaffold): /ws/alerts

## Feature Flags

- GATEWAY_PROVIDER to toggle payment gateways (Stripe/Adyen)
- REDIS_URL enables production Redis; tests fallback to in-memory
- EMERGENT_LLM_KEY enables AI moderation

## Notes

- CSRF double-submit cookie enforced on unsafe methods without Bearer token
- JWT refresh via HttpOnly cookie; rotation endpoint available
- 2FA (TOTP) endpoints scaffolded and mock-friendly for tests