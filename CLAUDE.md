# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
- `npm run build` — compile TypeScript to `dist/`
- `npm run start` — run compiled output (`node dist/server.js`)
- `npm run dev` — run with hot reload via `tsx watch`

There are no tests or linting configured in this project.

## Architecture
Single-file Express server in `src/server.ts` (211 lines). No router modules, no middleware files — everything lives in one file.

**Request flow for `POST /api/contact`:**
1. CORS check against `ALLOWED_ORIGINS` (denied origins get an error, not a CORS header)
2. Rate limiting — in-memory `Map<string, HitInfo>`, 3 requests per 15 min per IP
3. Form fields extracted via `firstString()` — accepts both string and single-element array values (handles `multipart/form-data` via multer with `.none()`)
4. Zod validation (`formSchema`): `name`, `email` (optional, validated only if non-empty), `message`, `website` (honeypot), `cf-turnstile-response`
5. Honeypot check — if `website` is non-empty, return 400 (bot rejection)
6. Cloudflare Turnstile server-side verification via `fetch` to `challenges.cloudflare.com`
7. SMTP email sent via Nodemailer (`transporter` created once at startup); if `SMTP_HOST` is unset, returns 500

**Other endpoints:**
- `OPTIONS /api/contact` → 204 (CORS preflight)
- Any other method on `/api/contact` → 405

**Error responses** all follow the shape `{ ok: false, message: string }` (plus `errors` array on validation failures). Success is `{ ok: true, message: "Message sent successfully." }`.

**IP resolution:** uses `x-forwarded-for` header (first entry) when present, falls back to `req.ip`.

**Key dependencies:** Express 4, Zod 3, Nodemailer 8, Multer 1 (multipart only — no file uploads).

## Docker
Multi-stage build in `Dockerfile`: build stage compiles TypeScript, runtime stage copies only `dist/` and production deps. Exposes port 3000.
