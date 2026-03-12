import { describe, it, expect } from 'vitest';
import { validateSQL, stripCodeFences } from '../src/pipeline/sql-validator.js';

describe('stripCodeFences', () => {
  it('strips ```sql fences', () => {
    const input = '```sql\nSELECT * FROM property_sales\n```';
    expect(stripCodeFences(input)).toBe('SELECT * FROM property_sales');
  });

  it('strips ```postgresql fences', () => {
    const input = '```postgresql\nSELECT * FROM property_sales\n```';
    expect(stripCodeFences(input)).toBe('SELECT * FROM property_sales');
  });

  it('strips bare ``` fences', () => {
    const input = '```\nSELECT * FROM property_sales\n```';
    expect(stripCodeFences(input)).toBe('SELECT * FROM property_sales');
  });

  it('returns plain SQL unchanged', () => {
    const input = 'SELECT * FROM property_sales';
    expect(stripCodeFences(input)).toBe('SELECT * FROM property_sales');
  });

  it('strips surrounding whitespace after removing fences', () => {
    const input = '  ```sql\n  SELECT 1  \n```  ';
    expect(stripCodeFences(input)).toBe('SELECT 1');
  });
});

describe('validateSQL', () => {
  it('accepts a simple SELECT', () => {
    const result = validateSQL('SELECT * FROM property_sales');
    expect(result).toEqual({ valid: true, sql: 'SELECT * FROM property_sales' });
  });

  it('accepts SELECT with WHERE, GROUP BY, ORDER BY, LIMIT', () => {
    const sql = "SELECT town, AVG(price) FROM property_sales WHERE ppd_category = 'A' GROUP BY town ORDER BY AVG(price) DESC LIMIT 10";
    const result = validateSQL(sql);
    expect(result).toEqual({ valid: true, sql });
  });

  it('strips trailing semicolon from a single statement', () => {
    const result = validateSQL('SELECT * FROM property_sales;');
    expect(result).toEqual({ valid: true, sql: 'SELECT * FROM property_sales' });
  });

  it('strips markdown code fences before validating', () => {
    const result = validateSQL('```sql\nSELECT * FROM property_sales\n```');
    expect(result).toEqual({ valid: true, sql: 'SELECT * FROM property_sales' });
  });

  it('strips leading and trailing whitespace', () => {
    const result = validateSQL('  SELECT * FROM property_sales  ');
    expect(result).toEqual({ valid: true, sql: 'SELECT * FROM property_sales' });
  });

  it('rejects empty input', () => {
    const result = validateSQL('');
    expect(result).toEqual({ valid: false, error: 'Empty SQL query' });
  });

  it('rejects whitespace only input', () => {
    const result = validateSQL('   \n\t  ');
    expect(result).toEqual({ valid: false, error: 'Empty SQL query' });
  });

  it('rejects INSERT statements', () => {
    const result = validateSQL("INSERT INTO property_sales (price) VALUES (100)");
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.error).toContain('INSERT');
  });

  it('rejects UPDATE statements', () => {
    const result = validateSQL("UPDATE property_sales SET price = 0");
    expect(result.valid).toBe(false);
  });

  it('rejects DELETE statements', () => {
    const result = validateSQL("DELETE FROM property_sales");
    expect(result.valid).toBe(false);
  });

  it('rejects DROP statements', () => {
    const result = validateSQL("DROP TABLE property_sales");
    expect(result.valid).toBe(false);
  });

  it('rejects ALTER statements', () => {
    const result = validateSQL("ALTER TABLE property_sales ADD COLUMN x INT");
    expect(result.valid).toBe(false);
  });

  it('rejects TRUNCATE statements', () => {
    const result = validateSQL("TRUNCATE property_sales");
    expect(result.valid).toBe(false);
  });

  it('rejects CREATE statements', () => {
    const result = validateSQL("CREATE TABLE evil (id INT)");
    expect(result.valid).toBe(false);
  });

  it('rejects GRANT statements', () => {
    const result = validateSQL("GRANT ALL ON property_sales TO public");
    expect(result.valid).toBe(false);
  });

  it('rejects REVOKE statements', () => {
    const result = validateSQL("REVOKE ALL ON property_sales FROM public");
    expect(result.valid).toBe(false);
  });

  it('rejects case variations of forbidden keywords', () => {
    const result = validateSQL("drop TABLE property_sales");
    expect(result.valid).toBe(false);
  });

  it('allows SELECT from pg_catalog (caught by AST validator)', () => {
    const result = validateSQL('SELECT * FROM pg_catalog.pg_user');
    expect(result).toEqual({ valid: true, sql: 'SELECT * FROM pg_catalog.pg_user' });
  });

  it('allows SELECT from information_schema (caught by AST validator)', () => {
    const result = validateSQL('SELECT * FROM information_schema.tables');
    expect(result).toEqual({ valid: true, sql: 'SELECT * FROM information_schema.tables' });
  });

  it('rejects REFUSE response from LLM', () => {
    const result = validateSQL('REFUSE');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Question is not about UK property sales');
    }
  });

  it('rejects REFUSE with surrounding whitespace', () => {
    const result = validateSQL('  REFUSE  ');
    expect(result.valid).toBe(false);
  });

  it('rejects REFUSE with trailing semicolon', () => {
    const result = validateSQL('REFUSE;');
    expect(result.valid).toBe(false);
  });

  it('rejects lowercase refuse', () => {
    const result = validateSQL('refuse');
    expect(result.valid).toBe(false);
  });

  it('rejects REFUSE with trailing period', () => {
    const result = validateSQL('REFUSE.');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Question is not about UK property sales');
    }
  });

  it('rejects REFUSE with trailing explanation', () => {
    const result = validateSQL('REFUSE because off topic');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Question is not about UK property sales');
    }
  });

  it('rejects REFUSE followed by newline and explanation', () => {
    const result = validateSQL('REFUSE\nThis is not about property sales');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe('Question is not about UK property sales');
    }
  });
});
