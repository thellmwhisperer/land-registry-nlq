import { describe, it, expect, beforeAll } from 'vitest';
import { validateSQLWithAST, initASTValidator } from '../src/pipeline/sql-ast-validator.js';

beforeAll(async () => {
  await initASTValidator();
});

describe('sql-ast-validator', () => {
  // ── Must ALLOW ────────────────────────────────────────────────

  it('allows simple SELECT from property_sales', () => {
    const result = validateSQLWithAST('SELECT * FROM property_sales');
    expect(result.valid).toBe(true);
  });

  it('allows SELECT with WHERE, GROUP BY, ORDER BY, LIMIT', () => {
    const sql = "SELECT town, AVG(price) FROM property_sales WHERE ppd_category = 'A' GROUP BY town ORDER BY AVG(price) DESC LIMIT 10";
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
  });

  it('allows SELECT with aggregations (COUNT, AVG, PERCENTILE_CONT)', () => {
    const sql = "SELECT COUNT(*), AVG(price), PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) FROM property_sales WHERE town = 'LONDON'";
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
  });

  it('allows SELECT from public.property_sales (schema-qualified)', () => {
    const result = validateSQLWithAST('SELECT * FROM public.property_sales');
    expect(result.valid).toBe(true);
  });

  it('allows SELECT with subqueries referencing allowed tables', () => {
    const sql = 'SELECT * FROM property_sales WHERE price > (SELECT AVG(price) FROM property_sales) LIMIT 10';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
  });

  it('allows CTEs that reference only allowed tables', () => {
    const sql = `WITH cte AS (SELECT town, AVG(price) AS avg FROM property_sales GROUP BY town) SELECT * FROM cte LIMIT 10`;
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
  });

  it('allows multiple CTEs referencing allowed tables', () => {
    const sql = `WITH a AS (SELECT town, AVG(price) AS avg FROM property_sales WHERE ppd_category = 'A' GROUP BY town), b AS (SELECT town, AVG(price) AS avg FROM property_sales WHERE ppd_category = 'B' GROUP BY town) SELECT a.town, a.avg, b.avg FROM a JOIN b ON a.town = b.town LIMIT 10`;
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
  });

  it('rejects CTEs that reference forbidden tables', () => {
    const sql = `WITH cte AS (SELECT * FROM pg_catalog.pg_user) SELECT * FROM cte`;
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(false);
  });

  it('rejects writable CTEs (DELETE inside CTE)', () => {
    const sql = `WITH deleted AS (DELETE FROM property_sales WHERE price = 0 RETURNING *) SELECT * FROM deleted`;
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('Write operations');
    }
  });

  it('rejects writable CTEs (UPDATE inside CTE)', () => {
    const sql = `WITH updated AS (UPDATE property_sales SET price = 0 RETURNING *) SELECT * FROM updated`;
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(false);
  });

  it('allows SELECT with CASE expressions', () => {
    const sql = "SELECT CASE WHEN property_type = 'D' THEN 'Detached' ELSE 'Other' END AS type, COUNT(*) FROM property_sales GROUP BY type";
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
  });

  // ── Must auto inject LIMIT ────────────────────────────────────

  it('auto injects LIMIT 1001 so the executor can detect truncation', () => {
    const result = validateSQLWithAST('SELECT * FROM property_sales');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
    }
  });

  it('injects LIMIT on scalar function queries (non-aggregate)', () => {
    const sql = 'SELECT upper(town) FROM property_sales';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
    }
  });

  it('strips trailing semicolons before injecting LIMIT', () => {
    const sql = 'SELECT * FROM property_sales;';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
      expect(result.sql).not.toContain(';');
    }
  });

  it('rejects LIMIT injection when trailing line comment would swallow it', () => {
    const sql = 'SELECT * FROM property_sales -- fetch all';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Failed to inject LIMIT safely');
    }
  });

  it('injects LIMIT when query ends with a string literal containing --', () => {
    const sql = "SELECT '--abc' AS x FROM property_sales";
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
    }
  });

  it('does not misclassify string literal as aggregate function', () => {
    const sql = "SELECT 'avg' AS label FROM property_sales";
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
    }
  });

  it('injects LIMIT when aggregate is only inside a scalar subquery', () => {
    const sql = 'SELECT (SELECT COUNT(*) FROM property_sales) AS c FROM property_sales';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
    }
  });

  it('does not inject LIMIT on aggregate queries', () => {
    const sql = 'SELECT COUNT(*) FROM property_sales';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).not.toContain('LIMIT 1000');
    }
  });

  it('preserves existing LIMIT', () => {
    const sql = 'SELECT * FROM property_sales LIMIT 10';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).not.toContain('LIMIT 1001');
    }
  });

  it('clamps LIMIT to 1001 when query specifies a higher value', () => {
    const sql = 'SELECT * FROM property_sales LIMIT 50000';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
      expect(result.sql).not.toContain('50000');
    }
  });

  it('clamps LIMIT ALL to 1001', () => {
    const sql = 'SELECT * FROM property_sales LIMIT ALL';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
      expect(result.sql).not.toContain('ALL');
    }
  });

  it('clamps LIMIT NULL to 1001', () => {
    const sql = 'SELECT * FROM property_sales LIMIT NULL';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
      expect(result.sql).not.toContain('NULL');
    }
  });

  it('clamps LIMIT correctly when SQL contains non-ASCII before it', () => {
    const sql = "SELECT 'ñ' AS x FROM property_sales LIMIT 50000";
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
      expect(result.sql).not.toContain('50000');
    }
  });

  it('clamps outer LIMIT without touching subquery LIMIT', () => {
    const sql = 'SELECT * FROM (SELECT * FROM property_sales LIMIT 5) x LIMIT 50000';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 5');
      expect(result.sql).toContain('LIMIT 1001');
      expect(result.sql).not.toContain('50000');
    }
  });

  it('preserves LIMIT when within the 1000 cap', () => {
    const sql = 'SELECT * FROM property_sales LIMIT 10';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 10');
    }
  });

  it('bumps LIMIT 1000 to 1001 for truncation detection', () => {
    const sql = 'SELECT * FROM property_sales LIMIT 1000';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
    }
  });

  // ── Must REJECT: non SELECT statements ────────────────────────

  it('rejects INSERT', () => {
    const result = validateSQLWithAST("INSERT INTO property_sales (price) VALUES (100)");
    expect(result.valid).toBe(false);
  });

  it('rejects UPDATE', () => {
    const result = validateSQLWithAST("UPDATE property_sales SET price = 0");
    expect(result.valid).toBe(false);
  });

  it('rejects DELETE', () => {
    const result = validateSQLWithAST("DELETE FROM property_sales");
    expect(result.valid).toBe(false);
  });

  it('rejects DROP', () => {
    const result = validateSQLWithAST("DROP TABLE property_sales");
    expect(result.valid).toBe(false);
  });

  it('rejects ALTER', () => {
    const result = validateSQLWithAST("ALTER TABLE property_sales ADD COLUMN x INT");
    expect(result.valid).toBe(false);
  });

  it('rejects TRUNCATE', () => {
    const result = validateSQLWithAST("TRUNCATE property_sales");
    expect(result.valid).toBe(false);
  });

  it('rejects CREATE', () => {
    const result = validateSQLWithAST("CREATE TABLE evil (id INT)");
    expect(result.valid).toBe(false);
  });

  // ── Must REJECT: forbidden schemas ────────────────────────────

  it('rejects SELECT from pg_catalog.pg_user', () => {
    const result = validateSQLWithAST('SELECT * FROM pg_catalog.pg_user');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Query rejected. Table pg_catalog.pg_user is not in the allowed list.');
    }
  });

  it('rejects SELECT from pg_catalog.pg_shadow', () => {
    const result = validateSQLWithAST('SELECT * FROM pg_catalog.pg_shadow');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Query rejected. Table pg_catalog.pg_shadow is not in the allowed list.');
    }
  });

  it('rejects SELECT from information_schema.tables', () => {
    const result = validateSQLWithAST('SELECT * FROM information_schema.tables');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Query rejected. Table information_schema.tables is not in the allowed list.');
    }
  });

  it('rejects SELECT from information_schema.columns', () => {
    const result = validateSQLWithAST('SELECT * FROM information_schema.columns');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Query rejected. Table information_schema.columns is not in the allowed list.');
    }
  });

  // ── Must REJECT: forbidden functions ──────────────────────────

  it('rejects SELECT using pg_sleep()', () => {
    const result = validateSQLWithAST('SELECT pg_sleep(10)');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('pg_sleep');
    }
  });

  it('rejects SELECT using pg_read_file()', () => {
    const result = validateSQLWithAST("SELECT pg_read_file('/etc/passwd')");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('pg_read_file');
    }
  });

  it('rejects SELECT using dblink()', () => {
    const result = validateSQLWithAST("SELECT * FROM dblink('host=evil', 'SELECT 1') AS t(id int)");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('dblink');
    }
  });

  // ── Must REJECT: other dangerous patterns ─────────────────────

  it('rejects multiple statements', () => {
    const result = validateSQLWithAST('SELECT 1; DROP TABLE property_sales');
    expect(result.valid).toBe(false);
  });

  it('rejects SELECT ... INTO (creates a table)', () => {
    const result = validateSQLWithAST('SELECT * INTO new_table FROM property_sales');
    expect(result.valid).toBe(false);
  });

  it('rejects any table not in the allowlist', () => {
    const result = validateSQLWithAST('SELECT * FROM users');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('users');
    }
  });

  it('rejects lo_import', () => {
    const result = validateSQLWithAST("SELECT lo_import('/etc/passwd')");
    expect(result.valid).toBe(false);
  });

  it('rejects lo_export', () => {
    const result = validateSQLWithAST("SELECT lo_export(1234, '/tmp/out')");
    expect(result.valid).toBe(false);
  });

  // ── Extended function blocklist ─────────────────────────────────

  it('rejects pg_read_binary_file()', () => {
    const result = validateSQLWithAST("SELECT pg_read_binary_file('/etc/passwd')");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('pg_read_binary_file');
  });

  it('rejects pg_ls_dir()', () => {
    const result = validateSQLWithAST("SELECT pg_ls_dir('/etc')");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('pg_ls_dir');
  });

  it('rejects pg_stat_file()', () => {
    const result = validateSQLWithAST("SELECT pg_stat_file('/etc/passwd')");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('pg_stat_file');
  });

  it('rejects dblink_exec()', () => {
    const result = validateSQLWithAST("SELECT dblink_exec('host=evil', 'DROP TABLE x')");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('dblink_exec');
  });

  it('rejects dblink_connect()', () => {
    const result = validateSQLWithAST("SELECT dblink_connect('host=evil dbname=prod')");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('dblink_connect');
  });

  it('rejects copy_to()', () => {
    const result = validateSQLWithAST("SELECT copy_to('property_sales', '/tmp/dump')");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('copy_to');
  });

  it('rejects copy_from()', () => {
    const result = validateSQLWithAST("SELECT copy_from('property_sales', '/tmp/evil')");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('copy_from');
  });

  it('rejects pg_terminate_backend()', () => {
    const result = validateSQLWithAST('SELECT pg_terminate_backend(1234)');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('pg_terminate_backend');
  });

  it('rejects pg_cancel_backend()', () => {
    const result = validateSQLWithAST('SELECT pg_cancel_backend(1234)');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('pg_cancel_backend');
  });

  it('rejects pg_reload_conf()', () => {
    const result = validateSQLWithAST('SELECT pg_reload_conf()');
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('pg_reload_conf');
  });

  it('rejects set_config()', () => {
    const result = validateSQLWithAST("SELECT set_config('log_statement', 'all', false)");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('set_config');
  });

  it('rejects current_setting() for config exfiltration', () => {
    const result = validateSQLWithAST("SELECT current_setting('data_directory')");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('current_setting');
  });

  it('rejects query_to_xml()', () => {
    const result = validateSQLWithAST("SELECT query_to_xml('SELECT 1', true, false, '')");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('query_to_xml');
  });

  it('rejects pg_sleep hidden in a subquery', () => {
    const sql = 'SELECT * FROM property_sales WHERE price > (SELECT pg_sleep(10)::int) LIMIT 1';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('pg_sleep');
  });

  it('rejects forbidden function in CTE', () => {
    const sql = "WITH x AS (SELECT pg_read_file('/etc/passwd') AS content) SELECT * FROM x";
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('pg_read_file');
  });

  // ── Safe functions must still be allowed ────────────────────────

  it('allows UPPER()', () => {
    const result = validateSQLWithAST('SELECT UPPER(town) FROM property_sales LIMIT 10');
    expect(result.valid).toBe(true);
  });

  it('allows ROUND()', () => {
    const result = validateSQLWithAST('SELECT ROUND(AVG(price)::numeric, 2) FROM property_sales');
    expect(result.valid).toBe(true);
  });

  it('allows EXTRACT()', () => {
    const result = validateSQLWithAST('SELECT EXTRACT(YEAR FROM date_of_transfer) FROM property_sales LIMIT 10');
    expect(result.valid).toBe(true);
  });

  // ── GROUP BY LIMIT injection ────────────────────────────────────

  it('injects LIMIT on GROUP BY with ORDER BY', () => {
    const sql = 'SELECT town, AVG(price) AS avg FROM property_sales GROUP BY town ORDER BY avg DESC';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
    }
  });

  it('injects LIMIT on GROUP BY without ORDER BY', () => {
    const sql = 'SELECT town, AVG(price) FROM property_sales GROUP BY town';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
    }
  });

  it('does not inject LIMIT on GROUP BY that already has one', () => {
    const sql = 'SELECT town, AVG(price) FROM property_sales GROUP BY town LIMIT 50';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 50');
      expect(result.sql).not.toContain('LIMIT 1001');
    }
  });

  it('clamps explicit LIMIT on unordered GROUP BY', () => {
    const sql = 'SELECT town, AVG(price) FROM property_sales GROUP BY town LIMIT 500000';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).toContain('LIMIT 1001');
      expect(result.sql).not.toContain('500000');
    }
  });

  it('does not inject LIMIT on pure aggregate (no GROUP BY)', () => {
    const sql = 'SELECT AVG(price) FROM property_sales';
    const result = validateSQLWithAST(sql);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.sql).not.toContain('LIMIT');
    }
  });
});
