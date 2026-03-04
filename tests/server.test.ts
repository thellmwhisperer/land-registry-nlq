import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/pipeline', () => ({
  ask: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  getPool: () => ({}),
  shutdown: vi.fn(),
}));

// Dynamic import after mocks are set up
const { default: request } = await import('supertest');

// Import the app — need to extract it from server.ts without starting the listener
const { app } = await import('../src/server.js');

describe('server', () => {
  it('returns 400 for malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/query')
      .set('Content-Type', 'application/json')
      .send('{"question": "truncated');

    expect(res.status).toBe(400);
  });

  it('returns 400 for missing question field', async () => {
    const res = await request(app)
      .post('/api/query')
      .send({ foo: 'bar' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing');
  });
});
