import { ask } from './pipeline/index.js';
import { shutdown } from './db/client.js';

const question = process.argv[2];

if (!question) {
  console.error('Usage: npx tsx src/index.ts "Your question here"');
  process.exit(1);
}

try {
  const result = await ask(question);
  console.log('\n' + JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await shutdown();
}
