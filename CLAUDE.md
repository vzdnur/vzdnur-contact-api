# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
- `npm run build` — compile TypeScript to `dist/`
- `npm run start` — run compiled output (`node dist/server.js`)
- `npm run dev` — run with hot reload via `tsx watch`

There are no tests or linting configured in this project.

## Architecture
Single-file Express server in `src/server.ts` (391 lines). No router modules, no middleware files — everything lives in one file. The project is ESM (`"type": "module"`), compiled with `NodeNext` module resolution targeting ES2022.

**Endpoints:**

| Method | Path                 | Purpose                              |
|--------|----------------------|--------------------------------------|
| GET    | /health              | Health check (200 + `{ ok: true }`)  |
| POST   | /api/contact         | General contact form                 |
| POST   | /api/demo-feedback   | Demo feedback / pilot interest form  |
| OPTIONS| /api/contact         | CORS preflight (204)                 |
| OPTIONS| /api/demo-feedback   | CORS preflight (204)                 |
| ALL    | /api/contact         | 405 Method Not Allowed catch-all     |
| ALL    | /api/demo-feedback   | 405 Method Not Allowed catch-all     |

CORS accepts any origin dynamically — no fixed allowlist.

**Shared request flow (both POST endpoints):**
1. CORS handled by `cors()` middleware (dynamic origin acceptance)
2. Rate limiting — in-memory `Map<string, HitInfo>`, 3 requests per 15 min per IP
3. Multipart form parsing via `multer().none()` (no file uploads)
4. Form fields extracted via `firstString()` — accepts both string and single-element array values
5. Zod validation against the endpoint-specific schema
6. Honeypot check — if `website` field is non-empty, return 400 (bot rejection)
7. Cloudflare Turnstile server-side verification via `fetch` to `challenges.cloudflare.com`
8. SMTP email sent via Nodemailer (`transporter` created once at startup); if `SMTP_HOST` is unset, returns 500

**Two form schemas:**
- `contactSchema` — `name` (required), `email` (optional, validated only if non-empty), `message` (required), `website` (honeypot), `cf-turnstile-response`
- `demoFeedbackSchema` — `email` (required), `nameOrCompany`, `pilotInterest`, `helpfulPerspective`, `valuableItems` (JSON string array, transformed via `parseStringArray`), `futureFeatures` (same), `message`, `locale` (`'de'|'en'`), `source` (must be `'demo_feedback'`), `website`, `cf-turnstile-response`

**Helper functions:**
- `firstString(value)` — extracts first string from a value that may be a string or array
- `getClientIp(req)` — uses `x-forwarded-for` header (first entry) when present, falls back to `req.ip`
- `getDomain(req)` — extracts domain from `origin` header, falls back to `host` header
- `isRateLimited(ip)` — checks/updates in-memory rate limit state
- `verifyTurnstile(token, ip)` — server-side Turnstile verification
- `parseStringArray(value, ctx, fieldName)` — parses a JSON string array with validation, caps at 30 items

**Error responses** all follow the shape `{ ok: false, message: string }` (plus `errors` array on validation failures). Success is `{ ok: true, message: "Message sent successfully." }`.

**Key dependencies:** Express 4, Zod 3, Nodemailer 8, Multer 1 (multipart only — no file uploads), cors 2, dotenv 16.

## Environment Variables

See `.env.example`. Required: `TURNSTILE_SECRET_KEY`, `SMTP_HOST`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`. Optional: `SMTP_PORT` (default 587), `SMTP_SECURE` (default false), `SMTP_USER`, `SMTP_PASS`, `PORT` (default 3000).

## Docker
Multi-stage build in `Dockerfile`: build stage compiles TypeScript, runtime stage copies only `dist/` and production deps. Exposes port 3000.

## Reference Documents
- `README.md` — project overview, security model, onboarding guide for new projects
- `SHARED-CONTACT-API-PLAN.md` — detailed architectural plan for multi-tenant project support (origin-based project detection, per-project schemas/templates, migration plan). The current code does NOT yet implement the full multi-tenant mapping described in the plan — it has two fixed endpoints with shared schemas.
