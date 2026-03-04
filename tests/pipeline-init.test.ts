import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoadModule = vi.hoisted(() => vi.fn());

vi.mock('libpg-query', () => ({
  loadModule: mockLoadModule,
  parseSync: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn() };
  },
}));

vi.mock('../src/db/client.js', () => ({
  getPool: () => ({
    connect: () => Promise.resolve({ query: vi.fn(), release: vi.fn() }),
  }),
}));

vi.mock('../src/schema/prompt-builder.js', () => ({
  buildSystemPrompt: () => 'prompt',
  loadSemanticLayer: () => '# layer',
}));

describe('pipeline init recovery', () => {
  beforeEach(() => {
    vi.resetModules();
    mockLoadModule.mockReset();
  });

  it('retries AST init after a transient failure', async () => {
    mockLoadModule
      .mockRejectedValueOnce(new Error('WASM load failed'))
      .mockResolvedValueOnce(undefined);

    const { ask } = await import('../src/pipeline/index.js');

    await expect(ask('test')).rejects.toThrow('WASM load failed');
    // Second call should retry init, not re-throw cached rejection
    await expect(ask('test')).rejects.not.toThrow('WASM load failed');
  });
});
