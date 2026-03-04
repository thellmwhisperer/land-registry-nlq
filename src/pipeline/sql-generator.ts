import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, loadSemanticLayer } from '../schema/prompt-builder.js';
import { validateSQL } from './sql-validator.js';

const client = new Anthropic();
const systemPrompt = buildSystemPrompt(loadSemanticLayer());

export async function generateSQL(question: string): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: question }],
  });

  const text = response.content[0];
  if (text.type !== 'text' || !text.text.trim()) {
    throw new Error('LLM returned empty response');
  }

  const result = validateSQL(text.text);

  if (!result.valid) {
    throw new Error(result.error);
  }

  return result.sql;
}
