import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.CORS_ORIGIN = 'http://localhost:5173';
});

const mockAsk = vi.fn();
vi.mock('../src/pipeline/index.js', () => ({
  ask: mockAsk,
}));

vi.mock('../src/db/client.js', () => ({
  getPool: () => ({}),
  shutdown: vi.fn(),
}));

const { default: request } = await import('supertest');
const { app } = await import('../src/server.js');

beforeEach(() => {
  mockAsk.mockReset();
});

describe('middleware', () => {
  // ── Helmet ──────────────────────────────────────────────────────

  it('sets X-Content-Type-Options header', async () => {
    const res = await request(app).post('/api/query').send({ question: 'test' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sets X-Frame-Options header', async () => {
    const res = await request(app).post('/api/query').send({ question: 'test' });
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  // ── CORS ────────────────────────────────────────────────────────

  it('allows requests from CORS_ORIGIN', async () => {
    const res = await request(app)
      .options('/api/query')
      .set('Origin', process.env.CORS_ORIGIN || 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBe(
      process.env.CORS_ORIGIN || 'http://localhost:5173',
    );
  });

  it('blocks requests from unknown origins', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .options('/api/query')
      .set('Origin', 'https://evil.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.status).toBeGreaterThanOrEqual(400);
    spy.mockRestore();
  });

  // ── Body size limit ─────────────────────────────────────────────

  it('rejects payloads over 10kb', async () => {
    const huge = JSON.stringify({ question: 'a'.repeat(20_000) });
    const res = await request(app)
      .post('/api/query')
      .set('Content-Type', 'application/json')
      .send(huge);

    expect(res.status).toBe(413);
  });

  // ── Rate limiting ───────────────────────────────────────────────

  it('returns rate limit headers', async () => {
    const res = await request(app)
      .post('/api/query')
      .send({ question: 'test' });

    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });

  it('returns JSON body on 429 rate limit', async () => {
    // Exhaust the rate limit (15 requests)
    for (let i = 0; i < 15; i++) {
      await request(app).post('/api/query').send({ question: 'test' });
    }
    // 16th request should be 429 with JSON
    const res = await request(app).post('/api/query').send({ question: 'test' });
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.error).toBeDefined();
  });

  it('does not rate-limit CORS preflight OPTIONS requests', async () => {
    const origin = process.env.CORS_ORIGIN || 'http://localhost:5173';
    const res = await request(app)
      .options('/api/query')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });
});
