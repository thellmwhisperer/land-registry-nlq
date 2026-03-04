import { getPool } from '../db/client.js';

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
}

export async function executeSQL(sql: string): Promise<QueryResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");

    const result = await client.query(sql);

    await client.query('COMMIT');

    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
      fields: result.fields.map((f: { name: string }) => f.name),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const message = err instanceof Error ? err.message : 'SQL execution failed';
    throw new Error(message);
  } finally {
    client.release();
  }
}
