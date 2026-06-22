# VZDNUR Contact API

Internal backend service in the same `vzdnur.com` repository.

## Purpose
- Receive contact form requests at `POST /api/contact`
- Verify Cloudflare Turnstile server-side
- Send contact email via SMTP

## Environment variables
- `PORT` (default `3000`)
- `ALLOWED_ORIGINS` (comma-separated)
- `TURNSTILE_SECRET_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE` (`true` or `false`)
- `SMTP_USER`
- `SMTP_PASS`
- `CONTACT_TO_EMAIL`
- `CONTACT_FROM_EMAIL`

## Security notes
- Do not commit real secrets.
- `TURNSTILE_SECRET_KEY` is server-side only.
- Service never logs secret values.
- Full message body is not logged.

## Local commands
- `npm install`
- `npm run build`
- `npm run start`
# vzdnur-contact-api
