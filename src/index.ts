import { ask } from './pipeline/index.js';
import { shutdown } from './db/client.js';
import { validateInput } from './pipeline/input-validator.js';

const question = process.argv[2];

if (!question) {
  console.error('Usage: npx tsx src/index.ts "Your question here"');
  process.exit(1);
}

const validation = validateInput(question);
if (!validation.valid) {
  console.error('Invalid question');
  process.exit(1);
}

let exitCode = 0;

try {
  const result = await ask(validation.question);
  console.log('\n' + JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Error:', err instanceof Error ? err.message : err);
  exitCode = 1;
} finally {
  await shutdown();
}

process.exit(exitCode);
