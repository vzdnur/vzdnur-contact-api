import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { z } from 'zod';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors({
  origin: (origin, callback) => callback(null, origin || true),
  methods: ['POST', 'OPTIONS', 'GET']
}));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
const multipartFormParser = multer().none();

const contactSchema = z.object({
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
});

function parseStringArray(value: string, ctx: z.RefinementCtx, fieldName: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldName} must be an array` });
      return z.NEVER;
    }

    const normalized = parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);

    if (normalized.length !== parsed.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldName} must contain only strings` });
      return z.NEVER;
    }

    return normalized.slice(0, 30);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${fieldName} must be valid JSON` });
    return z.NEVER;
  }
}

const demoFeedbackSchema = z.object({
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
});

const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpSecure = String(process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true';
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const contactTo = process.env.CONTACT_TO_EMAIL;
const contactFrom = process.env.CONTACT_FROM_EMAIL;

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined
});

type HitInfo = { count: number; resetAt: number };
const rateLimitWindowMs = 15 * 60 * 1000;
const rateLimitMax = 3;
const hits = new Map<string, HitInfo>();

const genericBotError = { ok: false, message: 'Request could not be verified.' };
const genericServerError = { ok: false, message: 'Unable to process request.' };
const successMessage = { ok: true, message: 'Message sent successfully.' };

function firstString(value: unknown): string {
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string');
    return typeof first === 'string' ? first : '';
  }
  return typeof value === 'string' ? value : '';
}

function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

function getDomain(req: express.Request): string {
  const origin = req.headers['origin'];
  if (typeof origin === 'string') {
    try {
      return new URL(origin).hostname;
    } catch { /* fall through */ }
  }
  const host = req.headers['host'];
  if (typeof host === 'string') {
    return host.split(':')[0];
  }
  return 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const current = hits.get(ip);
  if (!current || current.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
    return false;
  }
  if (current.count >= rateLimitMax) {
    return true;
  }
  current.count += 1;
  hits.set(ip, current);
  return false;
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  if (!turnstileSecret) {
    return false;
  }
  const body = new URLSearchParams();
  body.set('secret', turnstileSecret);
  body.set('response', token);
  if (ip && ip !== 'unknown') {
    body.set('remoteip', ip);
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    return false;
  }

  const payload = await response.json() as { success?: boolean };
  return payload.success === true;
}

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.options('/api/contact', (_req, res) => {
  res.sendStatus(204);
});

app.post('/api/contact', multipartFormParser, async (req, res) => {
  const ip = getClientIp(req);

  if (isRateLimited(ip)) {
    res.status(429).json({ ok: false, message: 'Too many requests. Please try later.' });
    return;
  }

  const raw = req.body as Record<string, unknown>;
  const payload = {
    name: firstString(raw.name),
    email: firstString(raw.email),
    message: firstString(raw.message),
    website: firstString(raw.website),
    'cf-turnstile-response': firstString(raw['cf-turnstile-response'])
  };
  const parsed = contactSchema.safeParse(payload);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message
    }));
    res.status(400).json({ ok: false, message: 'Invalid form submission.', errors });
    return;
  }

  const data = parsed.data;
  if (data.website && data.website.trim().length > 0) {
    res.status(400).json(genericBotError);
    return;
  }

  try {
    const verified = await verifyTurnstile(data['cf-turnstile-response'], ip);
    if (!verified) {
      res.status(400).json(genericBotError);
      return;
    }
  } catch (_error) {
    res.status(400).json(genericBotError);
    return;
  }

  if (!smtpHost || !contactTo || !contactFrom) {
    res.status(500).json(genericServerError);
    return;
  }

  const domain = getDomain(req);
  const timestamp = new Date().toISOString();

  try {
    const replyTo = data.email.length > 0 ? data.email : undefined;
    await transporter.sendMail({
      from: contactFrom,
      to: contactTo,
      replyTo,
      subject: `[${domain}] Contact Request`,
      text: [
        `New contact request from ${domain}`,
        `Timestamp: ${timestamp}`,
        `Name: ${data.name}`,
        `Email: ${data.email || '(not provided)'}`,
        '',
        'Message:',
        data.message
      ].join('\n')
    });

    res.status(200).json(successMessage);
  } catch (_error) {
    console.error('contact-api: mail send failed', { timestamp, ip, domain });
    res.status(500).json(genericServerError);
  }
});

app.all('/api/contact', (_req, res) => {
  res.status(405).json({ ok: false, message: 'Method not allowed.' });
});

app.options('/api/demo-feedback', (_req, res) => {
  res.sendStatus(204);
});

app.post('/api/demo-feedback', multipartFormParser, async (req, res) => {
  const ip = getClientIp(req);

  if (isRateLimited(ip)) {
    res.status(429).json({ ok: false, message: 'Too many requests. Please try later.' });
    return;
  }

  const raw = req.body as Record<string, unknown>;
  const payload = {
    email: firstString(raw.email),
    nameOrCompany: firstString(raw.nameOrCompany),
    pilotInterest: firstString(raw.pilotInterest),
    helpfulPerspective: firstString(raw.helpfulPerspective),
    valuableItems: firstString(raw.valuableItems),
    futureFeatures: firstString(raw.futureFeatures),
    message: firstString(raw.message),
    locale: firstString(raw.locale) || undefined,
    source: firstString(raw.source),
    website: firstString(raw.website),
    'cf-turnstile-response': firstString(raw['cf-turnstile-response'])
  };

  const parsed = demoFeedbackSchema.safeParse(payload);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message
    }));
    res.status(400).json({ ok: false, message: 'Invalid demo feedback submission.', errors });
    return;
  }

  const data = parsed.data;
  if (data.website && data.website.trim().length > 0) {
    res.status(400).json(genericBotError);
    return;
  }

  try {
    const verified = await verifyTurnstile(data['cf-turnstile-response'], ip);
    if (!verified) {
      res.status(400).json(genericBotError);
      return;
    }
  } catch (_error) {
    res.status(400).json(genericBotError);
    return;
  }

  if (!smtpHost || !contactTo || !contactFrom) {
    res.status(500).json(genericServerError);
    return;
  }

  const domain = getDomain(req);
  const timestamp = new Date().toISOString();
  const emptyValue = 'Keine Angabe';
  const listOrEmpty = (items: string[]) => items.length > 0
    ? items.map((item) => `✓ ${item}`).join('\n')
    : emptyValue;

  try {
    await transporter.sendMail({
      from: contactFrom,
      to: contactTo,
      replyTo: data.email,
      subject: `[${domain}] Demo Feedback / Pilotinteresse`,
      text: [
        'Neues Demo Feedback',
        '',
        '────────────────',
        '',
        'Kontakt:',
        '',
        `E-Mail: ${data.email}`,
        `Name/Firma: ${data.nameOrCompany || emptyValue}`,
        '',
        '────────────────',
        '',
        'Pilot Interesse:',
        '',
        data.pilotInterest || emptyValue,
        '',
        'Hilfreiche Ansicht:',
        '',
        data.helpfulPerspective || emptyValue,
        '',
        '────────────────',
        '',
        'Was war wertvoll?',
        '',
        listOrEmpty(data.valuableItems),
        '',
        '────────────────',
        '',
        'Interessante Erweiterungen:',
        '',
        listOrEmpty(data.futureFeatures),
        '',
        '────────────────',
        '',
        'Kommentar:',
        '',
        data.message || emptyValue,
        '',
        '────────────────',
        '',
        'Meta:',
        '',
        `Quelle: ${data.source}`,
        `Sprache: ${data.locale}`,
        `Zeitpunkt: ${timestamp}`
      ].join('\n')
    });

    res.status(200).json(successMessage);
  } catch (_error) {
    console.error('contact-api: demo feedback mail send failed', { timestamp, ip, domain });
    res.status(500).json(genericServerError);
  }
});

app.all('/api/demo-feedback', (_req, res) => {
  res.status(405).json({ ok: false, message: 'Method not allowed.' });
});

app.listen(port, () => {
  console.log(`contact-api listening on :${port}`);
});
