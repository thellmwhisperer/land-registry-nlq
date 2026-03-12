import { getPool } from '../db/client.js';

const MAX_ROWS = 1000;

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  fields: string[];
}

export async function executeSQL(sql: string): Promise<QueryResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");

    // Use a cursor to bound memory — only fetch MAX_ROWS + 1 rows
    await client.query(`DECLARE _nlq_cursor NO SCROLL CURSOR FOR ${sql}`);
    const result = await client.query(`FETCH ${MAX_ROWS + 1} FROM _nlq_cursor`);
    await client.query('CLOSE _nlq_cursor');

    await client.query('COMMIT');

    const truncated = result.rows.length > MAX_ROWS;
    const rows = truncated
      ? result.rows.slice(0, MAX_ROWS)
      : result.rows;

    return {
      rows,
      rowCount: truncated ? MAX_ROWS : result.rows.length,
      truncated,
      fields: result.fields.map((f: { name: string }) => f.name),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const message = err instanceof Error ? err.message : 'SQL execution failed';
    throw new Error(message, { cause: err });
  } finally {
    client.release();
  }
}
