import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { interpret } from '../src/pipeline/interpreter.js';

beforeEach(() => {
  mockCreate.mockReset();
});

describe('interpret', () => {
  it('sends question, SQL, and results to Haiku and returns plain English', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'The average house price in London is £523,000.' }],
    });

    const result = await interpret({
      question: 'What is the average house price in London?',
      sql: "SELECT AVG(price) FROM property_sales WHERE town = 'LONDON'",
      rows: [{ avg_price: 523000 }],
      rowCount: 1,
      fields: ['avg_price'],
    });

    expect(result).toBe('The average house price in London is £523,000.');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
      }),
    );
  });

  it('handles zero rows result', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'No results were found for that query.' }],
    });

    const result = await interpret({
      question: 'Show me sales in Atlantis',
      sql: "SELECT * FROM property_sales WHERE town = 'ATLANTIS'",
      rows: [],
      rowCount: 0,
      fields: ['price', 'town'],
    });

    expect(result).toBe('No results were found for that query.');
  });

  it('includes truncation notice in prompt when results are capped', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Over 1000 sales were found.' }],
    });

    await interpret({
      question: 'Show me all sales in London',
      sql: "SELECT * FROM property_sales WHERE town = 'LONDON'",
      rows: Array.from({ length: 50 }, (_, i) => ({ price: i })),
      rowCount: 1000,
      truncated: true,
      fields: ['price'],
    });

    const call = mockCreate.mock.calls[0][0];
    const userMsg = call.messages[0].content;
    expect(userMsg).toContain('truncated');
    expect(userMsg).toContain('1000');
  });
});
