import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

vi.mock('../src/db/client.js', () => ({
  getPool: () => ({
    connect: () => Promise.resolve({ query: mockQuery, release: mockRelease }),
  }),
}));

vi.mock('../src/schema/prompt-builder.js', () => ({
  buildSystemPrompt: () => 'system prompt',
  loadSemanticLayer: () => '# Semantic Layer',
}));

import { ask } from '../src/pipeline/index.js';

beforeEach(() => {
  mockCreate.mockReset();
  mockQuery.mockReset();
  mockRelease.mockReset();
});

describe('ask (pipeline)', () => {
  it('orchestrates the full pipeline: generate -> validate -> execute -> interpret', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: "SELECT AVG(price) FROM property_sales WHERE town = 'LONDON'" }],
    });

    mockQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // SET LOCAL statement_timeout
      .mockResolvedValueOnce({
        rows: [{ avg: 523000 }],
        rowCount: 1,
        fields: [{ name: 'avg' }],
      })
      .mockResolvedValueOnce(undefined); // COMMIT

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'The average price in London is £523,000.' }],
    });

    const result = await ask('What is the average house price in London?');

    expect(result.question).toBe('What is the average house price in London?');
    expect(result.sql).toBe("SELECT AVG(price) FROM property_sales WHERE town = 'LONDON'");
    expect(result.rows).toEqual([{ avg: 523000 }]);
    expect(result.interpretation).toBe('The average price in London is £523,000.');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('rejects SQL targeting system catalogs', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'SELECT * FROM pg_catalog.pg_user' }],
    });

    await expect(ask('Show me all database users')).rejects.toThrow(
      'Query rejected. Table pg_catalog.pg_user is not in the allowed list.',
    );
  });

  it('rejects SQL targeting information_schema', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'SELECT * FROM information_schema.tables' }],
    });

    await expect(ask('List all tables')).rejects.toThrow(
      'Query rejected. Table information_schema.tables is not in the allowed list.',
    );
  });
});
