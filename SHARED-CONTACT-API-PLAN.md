# SHARED-CONTACT-API-PLAN.md

## 1. Ziel des Projekts

Eine gemeinsame, mandantenfaehige Contact-API, die mehrere Websites mit
unterschiedlichen Kontaktformularen bedient. Statt pro Projekt eine eigene
contact-api zu deployen, laeuft eine einzige Instanz, die anhand von
Origin (Host) und Route die richtige Konfiguration (Schema, E-Mail,
Turnstile, CORS) auswaehlt.

## 2. Welche bestehenden Projekte spaeter angebunden werden sollen

| Projekt            | Aktueller Stand der contact-api        |
|--------------------|----------------------------------------|
| amtklar.at         | vorhanden, produktiv                   |
| pv-netzanschluss.at| vorhanden, produktiv                   |
| vzdnur.com         | vorhanden, produktiv                   |

Jedes dieser Projekte hat aktuell eine eigene contact-api mit eigenem Repo
und eigenem Deployment. Ziel ist, alle drei durch diese shared contact-api
abzuloesen.

## 3. Aktuelle Ausgangsbasis

Diese Codebase (`vzdnur-contact-api`) ist eine Kopie der amtKlar
contact-api. Stand bei Kopie:

- Einzelne Datei `src/server.ts` (~210 Zeilen)
- Express-Server auf Port 3000
- Route: POST /api/contact (plus OPTIONS und 405-Catch-All)
- Multer fuer multipart/form-data und application/json
- Zod-Schema: name, email (optional), message, website (Honeypot),
  cf-turnstile-response
- Cloudflare Turnstile Verifikation
- In-Memory Rate Limiting (3 Requests / 15 min pro IP)
- Nodemailer SMTP-Versand
- CORS: konfigurierbar ueber ALLOWED_ORIGINS (Default: amtklar.at)
- Betreff und Body der E-Mail hartcodiert auf "AMTKLAR Contact Request"
- Kein /health-Endpunkt
- Kein /api/demo-feedback-Endpunkt
- Keine Mandantenlogik

## 4. Ziel-Routen

| Methode | Pfad                 | Zweck                                |
|---------|----------------------|--------------------------------------|
| POST    | /api/contact         | Allgemeines Kontaktformular          |
| POST    | /api/demo-feedback   | Feedback-Formular nach Demo-Termin   |
| GET     | /health              | Health-Check (Load Balancer / K8s)   |

Zusaetzlich: OPTIONS-Preflight fuer beide POST-Routen, 405-Catch-All.

## 5. Project-Erkennung und formType-Ableitung

### 5.1 Grundprinzip: nichts Blindes aus dem Body

- `project` wird NICHT aus dem Request-Body akzeptiert.
- `project` wird aus dem Origin-Header des Requests abgeleitet.
- `formType` wird aus der Route abgeleitet.

### 5.2 project aus Origin ableiten

```
Origin                          -> project
https://amtklar.at              -> amtklar
https://www.amtklar.at          -> amtklar
https://pv-netzanschluss.at     -> pv-netzanschluss
https://www.pv-netzanschluss.at -> pv-netzanschluss
https://vzdnur.com              -> vzdnur
https://www.vzdnur.com          -> vzdnur
```

Mapping erfolgt statisch im Code. Requests ohne Origin (same-origin, z. B.
serverseitig) benoetigen einen eigenen Mechanismus (z. B. Default-Project
oder Host-Header-Fallback, siehe offene Fragen).

### 5.3 formType aus Route ableiten

```
Route                   -> formType
POST /api/contact       -> contact
POST /api/demo-feedback -> demo-feedback
```

### 5.4 Optional: project-Feld im Body validieren (nicht verwenden)

Falls das Frontend bereits ein `project`-Feld mitsendet, darf dieses Feld
NICHT zur Auswahl der Konfiguration verwendet werden. Es darf nur validiert
werden: Wenn es gesetzt ist, muss der Wert zum aus Origin abgeleiteten
project passen. Bei Mismatch: 400 Bad Request mit Hinweis auf inkonsistenten
Request.

### 5.5 Zusammenfassung Erkennungskette

```
1. Origin aus Request-Header extrahieren
2. Origin gegen erlaubte Origins matchen (CORS)
3. Origin auf project mappen (statische Lookup-Tabelle)
4. Route parsen -> formType
5. CORS-Origin-Set dynamisch aus Projektkonfiguration laden
6. (project, formType) -> Konfiguration (Schema, Template, Empfaenger, Turnstile)
```

## 6. Zielmodell: statisches Mapping + Env-Secrets

```
Origin -> project
Route  -> formType
(project, formType) -> {
  schema,           // Zod-Schema (pro Formular)
  toEmail,          // Empfaenger-E-Mail
  fromEmail,        // Absender-E-Mail
  subject,          // E-Mail-Betreff
  bodyTextLines,    // Funktion: (data, timestamp) -> string[]
  turnstileSecret,  // Cloudflare Turnstile Secret Key (aus Env)
  corsOrigins,      // Erlaubte Origins fuer dieses Projekt
}
```

Das Mapping ist in V1 ein statisches Objekt im Code (TypeScript-Modul).
Umgebungsspezifische Secrets (SMTP-Login, Turnstile-Keys) werden aus
Environment Variables gelesen.

Keine Datenbank, keine Runtime-Admin-Oberflaeche, kein dynamisches
Nachladen von Konfiguration.

### 6.1 Env-Variablen pro Projekt

SMTP ist projektuebergreifend (ein Mailserver).

Turnstile-Secrets pro Projekt:

```
TURNSTILE_SECRET_AMTKLAR
TURNSTILE_SECRET_PV_NETZANSCHLUSS
TURNSTILE_SECRET_VZDNUR
```

SMTP (gemeinsam):

```
SMTP_HOST
SMTP_PORT (default 587)
SMTP_SECURE (default false)
SMTP_USER
SMTP_PASS
```

Empfaenger-E-Mails pro Projekt (Defaultwerte, ueberschreibbar):

```
CONTACT_TO_AMTKLAR          (default: hallo@amtklar.at)
CONTACT_FROM_AMTKLAR        (default: hallo@amtklar.at)
CONTACT_TO_PV_NETZANSCHLUSS (default: hallo@pv-netzanschluss.at)
CONTACT_FROM_PV_NETZANSCHLUSS (default: hallo@pv-netzanschluss.at)
CONTACT_TO_VZDNUR           (default: hello@vzdnur.com)
CONTACT_FROM_VZDNUR         (default: hello@vzdnur.com)
```

## 7. Benoetigte Projekt/Form-Kombinationen

| project            | formType      | Status      |
|--------------------|---------------|-------------|
| amtklar            | contact       | uebernehmen  |
| pv-netzanschluss   | contact       | uebernehmen  |
| pv-netzanschluss   | demo-feedback | uebernehmen  |
| vzdnur             | contact       | uebernehmen  |

## 8. Formular-Schemas im Detail (aus Referenzprojekten exakt extrahiert)

### 8.1 amtklar / contact

Quelle: `../amtklar.at/contact-api/src/server.ts`

```typescript
z.object({
  name: z.string().trim().min(1).max(120),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((value) => value.length === 0 || z.string().email().safeParse(value).success, {
      message: 'Invalid email address.'
    }),
  message: z.string().trim().min(1).max(5000),
  website: z.string().optional().default(''),
  'cf-turnstile-response': z.string().trim().min(1)
})
```

Felder:

| Feld                    | Typ     | Pflicht  | Default | Regel                                   |
|-------------------------|---------|----------|---------|-----------------------------------------|
| name                    | string  | ja       | -       | trim, min 1, max 120                    |
| email                   | string  | nein     | -       | trim, max 254; wenn nicht leer: gueltige E-Mail |
| message                 | string  | ja       | -       | trim, min 1, max 5000                   |
| website                 | string  | nein     | ''      | Honeypot; wenn gefuellt -> Bot-Ablehnung |
| cf-turnstile-response   | string  | ja       | -       | trim, min 1                             |

E-Mail-Template:

```
Subject: AMTKLAR Contact Request
Body:
  New contact request from amtklar.at
  Timestamp: {timestamp}
  Name: {name}
  Email: {email || '(not provided)'}

  Message:
  {message}
```

replyTo: nur gesetzt wenn email.length > 0.

CORS Origins: `https://amtklar.at`, `https://www.amtklar.at`

### 8.2 pv-netzanschluss / contact

Quelle: `../pv-netzanschluss.at/contact-api/src/server.ts`

```typescript
z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  message: z.string().trim().min(1).max(5000),
  website: z.string().optional().default(''),
  'cf-turnstile-response': z.string().trim().min(1)
})
```

Felder:

| Feld                    | Typ     | Pflicht  | Default | Regel                        |
|-------------------------|---------|----------|---------|------------------------------|
| name                    | string  | ja       | -       | trim, min 1, max 120         |
| email                   | string  | ja       | -       | trim, gueltige E-Mail, max 254 |
| message                 | string  | ja       | -       | trim, min 1, max 5000        |
| website                 | string  | nein     | ''      | Honeypot                     |
| cf-turnstile-response   | string  | ja       | -       | trim, min 1                  |

E-Mail-Template:

```
Subject: PV-Netzanschluss Contact Request
Body:
  New contact request from pv-netzanschluss.at
  Timestamp: {timestamp}
  Name: {name}
  Email: {email}

  Message:
  {message}
```

replyTo: immer data.email.

CORS Origins: `https://pv-netzanschluss.at`, `https://www.pv-netzanschluss.at`

Log bei Mail-Fehler: `console.error('contact-api: mail send failed', { timestamp, ip, email: data.email })`

### 8.3 pv-netzanschluss / demo-feedback

Quelle: `../pv-netzanschluss.at/contact-api/src/server.ts`

```typescript
z.object({
  email: z.string().trim().email().max(254),
  nameOrCompany: z.string().trim().max(120).optional().default(''),
  pilotInterest: z.string().trim().max(160).optional().default(''),
  helpfulPerspective: z.string().trim().max(160).optional().default(''),
  valuableItems: z.string().trim().optional().default('[]')
    .transform((value, ctx) => parseStringArray(value, ctx, 'valuableItems')),
  futureFeatures: z.string().trim().optional().default('[]')
    .transform((value, ctx) => parseStringArray(value, ctx, 'futureFeatures')),
  message: z.string().trim().max(5000).optional().default(''),
  locale: z.enum(['de', 'en']).optional().default('de'),
  source: z.literal('demo_feedback'),
  website: z.string().optional().default(''),
  'cf-turnstile-response': z.string().trim().min(1)
})
```

Felder:

| Feld                    | Typ              | Pflicht  | Default | Regel                                          |
|-------------------------|------------------|----------|---------|------------------------------------------------|
| email                   | string           | ja       | -       | trim, gueltige E-Mail, max 254                  |
| nameOrCompany           | string           | nein     | ''      | trim, max 120                                   |
| pilotInterest           | string           | nein     | ''      | trim, max 160                                   |
| helpfulPerspective      | string           | nein     | ''      | trim, max 160                                   |
| valuableItems           | string (JSON)    | nein     | '[]'    | trim, JSON-Array aus Strings, transform -> string[], max 30 |
| futureFeatures          | string (JSON)    | nein     | '[]'    | trim, JSON-Array aus Strings, transform -> string[], max 30 |
| message                 | string           | nein     | ''      | trim, max 5000                                  |
| locale                  | enum             | nein     | 'de'    | 'de' oder 'en'                                  |
| source                  | string (literal) | ja       | -       | muss exakt 'demo_feedback' sein                 |
| website                 | string           | nein     | ''      | Honeypot                                        |
| cf-turnstile-response   | string           | ja       | -       | trim, min 1                                     |

JSON-String-Array-Transformation (`parseStringArray`):

- Input: String, der ein JSON-Array repraesentiert (z. B. `'["item1","item2"]'`)
- Parsing: `JSON.parse(value || '[]')`
- Validierung: muss ein Array sein
- Normalisierung: nur string-Elemente werden behalten, getrimmt, leere entfernt
- Fehler bei non-string items: `valuableItems must contain only strings`
- Fehler bei ungültigem JSON: `valuableItems must be valid JSON`
- Cap: maximal 30 Elemente
- Rueckgabe: `string[]`

E-Mail-Template:

```
Subject: [PV-Netzanschluss] Demo Feedback / Pilotinteresse
Body:
  Neues Demo Feedback

  ────────────────

  Kontakt:

  E-Mail: {email}
  Name/Firma: {nameOrCompany || 'Keine Angabe'}

  ────────────────

  Pilot Interesse:

  {pilotInterest || 'Keine Angabe'}

  Hilfreiche Ansicht:

  {helpfulPerspective || 'Keine Angabe'}

  ────────────────

  Was war wertvoll?

  {valuableItems als ✓-Liste oder 'Keine Angabe'}

  ────────────────

  Interessante Erweiterungen:

  {futureFeatures als ✓-Liste oder 'Keine Angabe'}

  ────────────────

  Kommentar:

  {message || 'Keine Angabe'}

  ────────────────

  Meta:

  Quelle: {source}
  Sprache: {locale}
  Zeitpunkt: {timestamp}
```

`listOrEmpty`-Hilfsfunktion:
- Wenn items.length > 0: `items.map(item => '✓ ' + item).join('\n')`
- Sonst: `'Keine Angabe'`
- `emptyValue = 'Keine Angabe'`

replyTo: immer data.email (email ist Pflicht).

CORS Origins: `https://pv-netzanschluss.at`, `https://www.pv-netzanschluss.at`

### 8.4 vzdnur / contact

Quelle: `../vzdnur.com/contact-api/src/server.ts`

```typescript
z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  message: z.string().trim().min(1).max(5000),
  website: z.string().optional().default(''),
  'cf-turnstile-response': z.string().trim().min(1)
})
```

Felder:

| Feld                    | Typ     | Pflicht  | Default | Regel                        |
|-------------------------|---------|----------|---------|------------------------------|
| name                    | string  | ja       | -       | trim, min 1, max 120         |
| email                   | string  | ja       | -       | trim, gueltige E-Mail, max 254 |
| message                 | string  | ja       | -       | trim, min 1, max 5000        |
| website                 | string  | nein     | ''      | Honeypot                     |
| cf-turnstile-response   | string  | ja       | -       | trim, min 1                  |

E-Mail-Template:

```
Subject: VZDNUR Contact Request
Body:
  New contact request from vzdnur.com
  Timestamp: {timestamp}
  Name: {name}
  Email: {email}

  Message:
  {message}
```

replyTo: immer data.email.

CORS Origins: `https://vzdnur.com`, `https://www.vzdnur.com`

### 8.5 Uebersicht Unterschiede Contact-Formular

| Merkmal              | amtklar      | pv-netzanschluss | vzdnur       |
|----------------------|--------------|------------------|--------------|
| email Pflicht        | nein         | ja               | ja           |
| email Validation     | optional     | .email()         | .email()     |
| replyTo              | bedingt      | immer            | immer        |
| Betreff              | AMTKLAR ...  | PV-Netzanschluss.| VZDNUR ...  |
| Body-Intro           | amtklar.at   | pv-netzanschluss.| vzdnur.com  |
| Email-Platzhalter    | (not prov.)  | entfaellt        | entfaellt    |
| Log bei Fehler       | nur timestamp| timestamp,ip,mail| timestamp,ip,mail |

## 9. Healthcheck

### GET /health

V1-Implementierung:

- Gibt ausschliesslich `200 OK` mit Body `{ "ok": true }` zurueck.
- Kein SMTP-Check (kein Nodemailer.verify()).
- Kein Turnstile-Check.
- Kein DNS-Check.
- Reine Alive-Status-Antwort fuer Load Balancer / Container-Orchestrator.

Erweiterung auf Deep-Checks fruehestens in V2, falls betrieblich notwendig.

## 10. Grober Migrationsplan ohne Downtime

### Infrastruktur-Zielbild

```
                        ┌─────────────────────┐
                        │ shared-contact-api   │
                        │ (Docker Container)    │
                        │ Port 3000             │
                        └──────────┬──────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
    ┌─────────┴─────────┐ ┌───────┴────────┐ ┌─────────┴─────────┐
    │ Web-Nginx amtklar │ │ Web-Nginx pv   │ │ Web-Nginx vzdnur  │
    │                    │ │                │ │                    │
    │ proxy /api/contact │ │ proxy /api/    │ │ proxy /api/contact │
    │ -> shared:3000     │ │ contact        │ │ -> shared:3000     │
    │                    │ │ -> shared:3000 │ │                    │
    │                    │ │ proxy /api/    │ │                    │
    │                    │ │ demo-feedback  │ │                    │
    │                    │ │ -> shared:3000 │ │                    │
    └────────────────────┘ └────────────────┴─────────────────────┘
```

- Jedes Projekt hat seinen eigenen Web-Nginx (bereits vorhanden).
- Nginx leitet `/api/contact` (und ggf. `/api/demo-feedback`) per
  `proxy_pass` an `shared-contact-api:3000` weiter.
- Die alte lokale contact-api (pro Projektrepo) bleibt parallel als
  Docker-Service bestehen, wird aber nicht mehr angefahren.
- Rollback pro Projekt: Nginx-Config zurueck auf lokale contact-api.

### Phase 1: Analyse (abgeschlossen)

- Alle drei Referenz-Server.ts exakt ausgelesen
- Schemas, Templates, CORS, Defaults dokumentiert
- Unterschiede identifiziert
- SHARED-CONTACT-API-PLAN.md erstellt (dieses Dokument)

### Phase 2: Umbau lokal (kein Deploy)

- project-Erkennung aus Origin implementieren (statische Lookup-Tabelle)
- formType-Ableitung aus Route
- Konfigurations-Mapping (project, formType) -> schema/template/recipient
- Alle vier Formular-Schemas anlegen (3x contact + 1x demo-feedback)
- `parseStringArray`-Hilfsfunktion aus PV-Codebase uebernehmen
- /health-Endpunkt hinzufuegen (nur 200 + ok)
- /api/demo-feedback-Route hinzufuegen
- /api/contact-Route mandantenfaehig machen
- E-Mail-Templates mandantenfaehig machen
- CORS dynamisch pro Projekt laden
- Keine Akzeptanz von `project` aus dem Request-Body (ausser Validierung
  auf Konsistenz, siehe 5.4)
- Env fuer alle Projekte vorbereiten (TURNSTILE_SECRET_*, CONTACT_*)

### Phase 3: Staging-Test

- shared-contact-api parallel zu einer bestehenden contact-api deployen
  (neuer Docker-Service, anderer Name)
- Ein Projekt-Nginx temporaer auf shared:3000 umstellen
- Alle Requests des Projekts ueber neue API leiten
- Alte contact-api laeuft weiter (kein Traffic)
- Bei Problemen: Nginx zurueck auf alte contact-api
- Test fuer alle drei Projekte nacheinander durchfuehren

### Phase 4: Produktiv-Umstellung pro Projekt

- Nginx-Config eines Projekts aendern:
  `proxy_pass http://shared-contact-api:3000;` statt lokaler API
- docker-compose neu laden / nginx reload
- Alte contact-api laeuft weiter, empfaengt keinen Traffic mehr
- Monitoring beobachten
- Nach erfolgreicher Verifikation: lokale contact-api aus
  docker-compose entfernen
- Naechstes Projekt umstellen
- Kein Big-Bang — Projekte einzeln migrierbar

## 11. Rate-Limiting-Entscheidung

- Rate Limit global ueber alle Projekte: 3 Requests / 15 min pro IP
- Identisch zum aktuellen Stand in allen drei Einzel-APIs
- Bei Engpaessen in V2: Rate Limit pro Projekt konfigurierbar machen

## 12. Offene Fragen

1. **project + formType Uebermittlung:**
   Geklaert: project aus Origin, formType aus Route.
   Offen: Was tun bei Requests ohne Origin-Header (same-origin, Server-
   to-Server)?

2. **Origin-Mapping bei mehreren Domains pro Projekt:**
   Soll z. B. https://vzdnur.at auch auf project=vzdnur gemappt werden?
   Falls ja: Mapping-Tabelle um Eintraege erweitern.

3. **Turnstile Secret Keys:**
   Pro Projekt ein eigener Key (empfohlen). Env-Variablen:
   TURNSTILE_SECRET_AMTKLAR, TURNSTILE_SECRET_PV_NETZANSCHLUSS,
   TURNSTILE_SECRET_VZDNUR. Bereits im Plan festgehalten.

4. **SMTP-Konfiguration:**
   Ein gemeinsamer SMTP-Server oder projektspezifische Absender?
   Aktuell bei allen drei Projekten unterschiedliche From/To-Defaults
   aber potenziell gleicher SMTP-Server. Klaeren, ob ein gemeinsamer
   SMTP alle drei Absender-Domains abdeckt (SPF/DKIM).

5. **Rate Limiting:**
   3 Requests / 15 min pro IP global ueber alle Projekte — ausreichend
   oder sollen es 3 pro Projekt sein? Entscheidung: V1 global.

6. **Logging und Monitoring:**
   Welches Format? Aktuell nur `console.error` bei Mail-Fehlern.
   Soll einheitliches Structured-JSON-Logging eingefuehrt werden?
   Metriken fuer Prometheus?

7. **Docker-Image-Name und Tagging:**
   Wie soll das Image heissen? `shared-contact-api:latest`?
   Versionierung?

8. **Deployment-Target:**
   Auf welchem Host / Cluster laeuft die shared-contact-api?
   Gleicher Docker-Host wie die Web-Nginx-Container der Projekte?
