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

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text' || !textBlock.text.trim()) {
    throw new Error('LLM returned empty response');
  }

  const result = validateSQL(textBlock.text);

  if (!result.valid) {
    throw new Error(result.error);
  }

  return result.sql;
}
