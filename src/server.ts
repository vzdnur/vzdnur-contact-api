import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { z } from 'zod';

const app = express();
const port = Number(process.env.PORT ?? 3000);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://amtklar.at,https://www.amtklar.at')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'OPTIONS']
}));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
const multipartFormParser = multer().none();

const formSchema = z.object({
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

const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpSecure = String(process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true';
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const contactTo = process.env.CONTACT_TO_EMAIL ?? 'hallo@amtklar.at';
const contactFrom = process.env.CONTACT_FROM_EMAIL ?? 'hallo@amtklar.at';

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
  const parsed = formSchema.safeParse(payload);
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

  if (!smtpHost) {
    res.status(500).json(genericServerError);
    return;
  }

  const timestamp = new Date().toISOString();

  try {
    const replyTo = data.email.length > 0 ? data.email : undefined;
    await transporter.sendMail({
      from: contactFrom,
      to: contactTo,
      replyTo,
      subject: 'AMTKLAR Contact Request',
      text: [
        'New contact request from amtklar.at',
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
    console.error('contact-api: mail send failed', { timestamp });
    res.status(500).json(genericServerError);
  }
});

app.all('/api/contact', (_req, res) => {
  res.status(405).json({ ok: false, message: 'Method not allowed.' });
});

app.listen(port, () => {
  console.log(`contact-api listening on :${port}`);
});
