import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import pg from 'pg';

const DB_URL = 'postgresql://nlq_readonly:nlq_readonly@localhost:5436/land_registry';

describe.runIf(process.env.TEST_DB === '1')('database hardening (nlq_readonly role)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('can SELECT from property_sales', async () => {
    const res = await pool.query('SELECT COUNT(*) AS n FROM property_sales');
    expect(Number(res.rows[0].n)).toBeGreaterThan(0);
  });

  it('cannot INSERT into property_sales', async () => {
    await expect(
      pool.query("INSERT INTO property_sales (price) VALUES (1)"),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot UPDATE property_sales', async () => {
    await expect(
      pool.query("UPDATE property_sales SET price = 0 WHERE price = 1"),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot DELETE from property_sales', async () => {
    await expect(
      pool.query("DELETE FROM property_sales WHERE price = 1"),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot CREATE tables', async () => {
    await expect(
      pool.query("CREATE TABLE evil (id int)"),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot access pg_catalog.pg_authid', async () => {
    await expect(
      pool.query("SELECT 1 FROM pg_catalog.pg_authid LIMIT 1"),
    ).rejects.toThrow(/permission denied/);
  });

  it('cannot CREATE TEMP tables', async () => {
    await expect(
      pool.query("CREATE TEMP TABLE tmp_evil (id int)"),
    ).rejects.toThrow(/permission denied/);
  });

  it('has statement_timeout configured at role level', async () => {
    const res = await pool.query("SHOW statement_timeout");
    expect(res.rows[0].statement_timeout).toBe('10s');
  });

  it('has log_min_duration_statement configured at role level', async () => {
    const res = await pool.query("SHOW log_min_duration_statement");
    expect(res.rows[0].log_min_duration_statement).toBe('5s');
  });
});
