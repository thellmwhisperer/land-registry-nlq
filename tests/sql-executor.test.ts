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
  it('executes SQL and returns rows, rowCount, and fields', async () => {
    mockQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // SET LOCAL statement_timeout
      .mockResolvedValueOnce({
        rows: [{ avg_price: 500000 }],
        rowCount: 1,
        fields: [{ name: 'avg_price' }],
      })
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await executeSQL("SELECT AVG(price) AS avg_price FROM property_sales WHERE town = 'LONDON'");
    expect(result.rows).toEqual([{ avg_price: 500000 }]);
    expect(result.rowCount).toBe(1);
    expect(result.fields).toEqual(['avg_price']);
  });

  it('uses SET LOCAL for statement_timeout inside a transaction', async () => {
    mockQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [], rowCount: 0, fields: [] })
      .mockResolvedValueOnce(undefined);

    await executeSQL('SELECT 1');
    expect(mockQuery).toHaveBeenCalledWith('BEGIN READ ONLY');
    expect(mockQuery).toHaveBeenCalledWith("SET LOCAL statement_timeout = '10s'");
    expect(mockQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('executes the SQL as provided (LIMIT handled by AST validator)', async () => {
    mockQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [], rowCount: 0, fields: [] })
      .mockResolvedValueOnce(undefined);

    await executeSQL('SELECT * FROM property_sales LIMIT 1000');
    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM property_sales LIMIT 1000');
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
      .mockResolvedValueOnce({ rows: [], rowCount: 0, fields: [] })
      .mockResolvedValueOnce(undefined);

    await executeSQL('SELECT 1');
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});
