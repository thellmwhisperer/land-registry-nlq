import { generateSQL } from './sql-generator.js';
import { validateSQLWithAST, initASTValidator } from './sql-ast-validator.js';
import { executeSQL } from './sql-executor.js';
import { interpret } from './interpreter.js';

interface Answer {
  question: string;
  sql: string;
  rows: Record<string, unknown>[];
  interpretation: string;
}

let initPromise: Promise<void> | null = null;

export async function ask(question: string): Promise<Answer> {
  if (!initPromise) {
    initPromise = initASTValidator();
  }
  await initPromise;

  console.log(`→ Question: ${question}`);

  const sql = await generateSQL(question);
  console.log(`→ SQL generated: ${sql}`);

  const astResult = validateSQLWithAST(sql);
  if (!astResult.valid) {
    throw new Error(astResult.error);
  }
  const validatedSql = astResult.sql;
  console.log('→ AST validator: PASS');

  const queryResult = await executeSQL(validatedSql);
  console.log(`→ Executed: ${queryResult.rowCount} row(s) returned`);

  const interpretation = await interpret({
    question,
    sql: validatedSql,
    rows: queryResult.rows,
    rowCount: queryResult.rowCount,
    fields: queryResult.fields,
  });
  console.log('→ Interpretation complete');

  return { question, sql: validatedSql, rows: queryResult.rows, interpretation };
}
