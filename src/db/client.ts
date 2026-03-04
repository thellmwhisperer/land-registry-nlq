import pg from 'pg';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not set in the environment');
    }

    pool = new pg.Pool({ connectionString });
  }

  return pool;
}

export async function shutdown(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
