import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

interface InterpretInput {
  question: string;
  sql: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
}

const MAX_ROWS_FOR_INTERPRETATION = 50;

const SYSTEM_PROMPT = `Summarise these query results in plain English for a non technical user.
Mention key numbers and trends. Format prices with £ and commas.
If zero rows returned, explain what that might mean.
Keep it to 2 or 3 sentences unless the data is complex.
NEVER use markdown formatting. No headers (#), no bold (**), no bullet points (- or *), no code blocks. Write plain text only.`;

export async function interpret(input: InterpretInput): Promise<string> {
  const previewRows = input.rows.slice(0, MAX_ROWS_FOR_INTERPRETATION);
  const truncated = input.rows.length > MAX_ROWS_FOR_INTERPRETATION
    ? `\n(showing first ${MAX_ROWS_FOR_INTERPRETATION} of ${input.rowCount} rows)`
    : '';

  const userMessage = `Question: ${input.question}

SQL executed: ${input.sql}

Results (${input.rowCount} row(s), columns: ${input.fields.join(', ')}):
${JSON.stringify(previewRows, null, 2)}${truncated}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Interpreter returned no text response');
  }

  return textBlock.text;
}
