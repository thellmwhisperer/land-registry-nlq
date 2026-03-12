import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

vi.mock('../src/schema/prompt-builder.js', () => ({
  buildSystemPrompt: () => 'system prompt here',
  buildUserMessage: (q: string) => `<user_query>\n${q}\n</user_query>`,
  loadSemanticLayer: () => '# Semantic Layer',
}));

import { generateSQL } from '../src/pipeline/sql-generator.js';

beforeEach(() => {
  mockCreate.mockReset();
});

describe('generateSQL', () => {
  it('sends the question to Haiku and returns validated SQL', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: "SELECT AVG(price) FROM property_sales WHERE town = 'LONDON'" }],
    });

    const result = await generateSQL('What is the average house price in London?');
    expect(result).toBe("SELECT AVG(price) FROM property_sales WHERE town = 'LONDON'");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        system: 'system prompt here',
        messages: [{ role: 'user', content: '<user_query>\nWhat is the average house price in London?\n</user_query>' }],
      }),
    );
  });

  it('strips code fences from LLM output', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '```sql\nSELECT 1\n```' }],
    });

    const result = await generateSQL('test');
    expect(result).toBe('SELECT 1');
  });

  it('throws when the LLM returns invalid SQL', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'DROP TABLE property_sales' }],
    });

    await expect(generateSQL('test')).rejects.toThrow('DROP');
  });

  it('throws when the LLM returns empty content', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '' }],
    });

    await expect(generateSQL('test')).rejects.toThrow();
  });
});
