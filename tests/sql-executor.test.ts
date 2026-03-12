import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeSQL } from '../src/pipeline/sql-executor.js';

const mockQuery = vi.fn();
const mockRelease = vi.fn();

vi.mock('../src/db/client.js', () => ({
  getPool: () => ({
    connect: () => Promise.resolve({ query: mockQuery, release: mockRelease }),
  }),
}));

beforeEach(() => {
  mockQuery.mockReset();
  mockRelease.mockReset();
});

describe('executeSQL', () => {
  it('executes SQL via cursor and returns rows, rowCount, and fields', async () => {
    mockQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // SET LOCAL statement_timeout
      .mockResolvedValueOnce(undefined) // DECLARE cursor
      .mockResolvedValueOnce({          // FETCH
        rows: [{ avg_price: 500000 }],
        rowCount: 1,
        fields: [{ name: 'avg_price' }],
      })
      .mockResolvedValueOnce(undefined) // CLOSE cursor
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await executeSQL("SELECT AVG(price) AS avg_price FROM property_sales WHERE town = 'LONDON'");
    expect(result.rows).toEqual([{ avg_price: 500000 }]);
    expect(result.rowCount).toBe(1);
    expect(result.fields).toEqual(['avg_price']);
  });

  it('uses a cursor to bound memory', async () => {
    mockQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [], rowCount: 0, fields: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await executeSQL('SELECT * FROM property_sales');
    expect(mockQuery).toHaveBeenCalledWith('BEGIN READ ONLY');
    expect(mockQuery).toHaveBeenCalledWith("SET LOCAL statement_timeout = '10s'");
    expect(mockQuery).toHaveBeenCalledWith('DECLARE _nlq_cursor NO SCROLL CURSOR FOR SELECT * FROM property_sales');
    expect(mockQuery).toHaveBeenCalledWith('FETCH 1001 FROM _nlq_cursor');
    expect(mockQuery).toHaveBeenCalledWith('CLOSE _nlq_cursor');
    expect(mockQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back and wraps pg errors', async () => {
    mockQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // SET LOCAL
      .mockRejectedValueOnce(new Error('relation "x" does not exist'))
      .mockResolvedValueOnce(undefined); // ROLLBACK

    await expect(executeSQL('SELECT * FROM x')).rejects.toThrow('relation "x" does not exist');
  });

  it('releases the client back to the pool', async () => {
    mockQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [], rowCount: 0, fields: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await executeSQL('SELECT 1');
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('truncates at 1000 rows when cursor returns 1001', async () => {
    const fetchedRows = Array.from({ length: 1001 }, (_, i) => ({ id: i }));
    mockQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // SET LOCAL
      .mockResolvedValueOnce(undefined) // DECLARE
      .mockResolvedValueOnce({          // FETCH 1001
        rows: fetchedRows,
        rowCount: 1001,
        fields: [{ name: 'id' }],
      })
      .mockResolvedValueOnce(undefined) // CLOSE
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await executeSQL('SELECT id FROM property_sales');
    expect(result.rows).toHaveLength(1000);
    expect(result.rowCount).toBe(1000);
    expect(result.truncated).toBe(true);
    expect(result.rows[0]).toEqual({ id: 0 });
    expect(result.rows[999]).toEqual({ id: 999 });
  });

  it('passes through results under the cap unchanged', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    mockQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows, rowCount: 2, fields: [{ name: 'id' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const result = await executeSQL('SELECT id FROM property_sales LIMIT 2');
    expect(result.rows).toHaveLength(2);
    expect(result.rowCount).toBe(2);
    expect(result.truncated).toBe(false);
  });
});
