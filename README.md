# Shared Contact API

Generische Contact-API fuer mehrere eigene Websites. Eine Instanz bedient
alle Projekte mit einer zentralen Konfiguration.

## Zweck

- Empfaengt Kontaktformular-Requests von verschiedenen Domains
- Verifiziert Cloudflare Turnstile serverseitig
- Sendet E-Mails an eine zentrale Inbox
- Domain wird aus Origin/Host abgeleitet und in Betreff und Body sichtbar

## Routen

| Methode | Pfad                 | Beschreibung                         |
|---------|----------------------|--------------------------------------|
| GET     | /health              | Health-Check (200 + ok)              |
| POST    | /api/contact         | Allgemeines Kontaktformular          |
| POST    | /api/demo-feedback   | Feedback nach Demo-Termin            |

CORS: jeder Origin wird dynamisch erlaubt, kein Wildcard-Header.

## Turnstile

Ein gemeinsames Cloudflare Turnstile Widget fuer alle angeschlossenen
Domains. Der `TURNSTILE_SECRET_KEY` ist zentral in dieser API
konfiguriert. Frontends verwenden denselben `PUBLIC_TURNSTILE_SITE_KEY`.

## E-Mail

Alle Formulare senden an dieselbe zentrale Inbox (`CONTACT_TO_EMAIL`).
Die Herkunft ist im Betreff sichtbar: `[domain] Contact Request` bzw.
`[domain] Demo Feedback / Pilotinteresse`.

## Sicherheit

- Kein Empfaenger aus Request — immer `CONTACT_TO_EMAIL`
- Kein Absender aus Request — immer `CONTACT_FROM_EMAIL`
- Kein offenes Mail-Relay
- Honeypot-Feld `website` — wenn gefuellt, wird Request verworfen
- Rate Limit: 3 Requests / 15 Minuten pro IP
- Turnstile serverseitig verifiziert
- Secrets werden nie geloggt

## Environment Variables

Siehe `.env.example`:

| Variable              | Pflicht  | Default | Beschreibung                          |
|-----------------------|----------|---------|---------------------------------------|
| TURNSTILE_SECRET_KEY  | ja       | -       | Cloudflare Turnstile Secret Key       |
| SMTP_HOST             | ja       | -       | SMTP Server Hostname                  |
| SMTP_PORT             | nein     | 587     | SMTP Port                             |
| SMTP_SECURE           | nein     | false   | TLS (true/false)                      |
| SMTP_USER             | nein     | -       | SMTP Auth Benutzername                |
| SMTP_PASS             | nein     | -       | SMTP Auth Passwort                    |
| CONTACT_TO_EMAIL      | ja       | -       | Zentrale Empfaenger-Adresse           |
| CONTACT_FROM_EMAIL    | ja       | -       | Zentrale Absender-Adresse             |
| PORT                  | nein     | 3000    | HTTP Listen Port                      |

## Neue Projekte anbinden

Keine Code-Aenderung an dieser API noetig:

1. Neue Domain im gemeinsamen Cloudflare Turnstile Widget erlauben
2. Gleichen `PUBLIC_TURNSTILE_SITE_KEY` im Frontend verwenden
3. Web-Nginx des Projekts konfigurieren:

```
location /api/contact {
    proxy_pass http://shared-contact-api:3000;
}
location /api/demo-feedback {
    proxy_pass http://shared-contact-api:3000;
}
```

## Lokale Entwicklung

```
npm install
npm run build
npm run start
npm run dev    # hot reload mit tsx
```
