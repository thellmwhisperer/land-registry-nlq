import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { ask } from './pipeline/index.js';
import { validateInput } from './pipeline/input-validator.js';

export function parseTrustProxy(val: string | undefined): boolean | number | string {
  if (!val || val === 'false' || val === '0') return false;
  if (val === 'true') return true;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  return val;
}

export const app = express();

app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
app.use(helmet());
const allowedOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin(requestOrigin, callback) {
    // No Origin header (e.g. server-to-server, curl) — always allow
    if (!requestOrigin) {
      callback(null, true);
      return;
    }
    if (!allowedOrigin || requestOrigin === allowedOrigin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));
const parsedLimit = parseInt(process.env.RATE_LIMIT || '15', 10);
const RATE_LIMIT = Number.isNaN(parsedLimit) || parsedLimit <= 0 ? 15 : parsedLimit;
app.use(rateLimit({
  windowMs: 60_000,
  limit: RATE_LIMIT,
  standardHeaders: 'draft-6',
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many requests' });
  },
}));
app.use(express.json({ limit: '10kb' }));

app.post('/api/query', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    const question = body?.question;

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Invalid question' });
      return;
    }

    const validation = validateInput(question);
    if (!validation.valid) {
      res.status(400).json({ error: 'Invalid question' });
      return;
    }

    const result = await ask(validation.question);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use((err: Error & { status?: number }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const msg = err.message.toLowerCase();
  const isClientError = msg.startsWith('query rejected')
    || msg.includes('not allowed')
    || msg.includes('not about uk property sales')
    || msg.startsWith('forbidden function')
    || msg.startsWith('failed to parse sql')
    || msg.startsWith('failed to inject limit')
    || msg.startsWith('empty sql query')
    || msg.startsWith('multiple statements')
    || msg.startsWith('only select')
    || msg.startsWith('write operations')
    || msg.startsWith('select into');
  const status = err.status ?? (isClientError ? 400 : 500);

  const body = req.body as Record<string, unknown> | undefined;

  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    status,
    question: body?.question ?? null,
    error: err.message,
    stack: status >= 500 ? err.stack ?? null : null,
  }));

  res.status(status).json({
    error: status < 500 ? 'Invalid question' : 'Internal server error',
  });
});

const PORT = process.env.PORT || 3000;

if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
