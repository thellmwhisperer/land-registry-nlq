type ValidationSuccess = { valid: true; sql: string };
type ValidationFailure = { valid: false; error: string };
export type ValidationResult = ValidationSuccess | ValidationFailure;

const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CREATE',
  'GRANT',
  'REVOKE',
];

const FORBIDDEN_PATTERN = new RegExp(
  `^\\s*(${FORBIDDEN_KEYWORDS.join('|')})\\b`,
  'i',
);

export function stripCodeFences(input: string): string {
  let sql = input.trim();
  sql = sql.replace(/^```(?:sql|postgresql)?\s*\n?/i, '');
  sql = sql.replace(/\n?```\s*$/, '');
  return sql.trim();
}

export function validateSQL(raw: string): ValidationResult {
  let sql = stripCodeFences(raw).trim();

  if (!sql) {
    return { valid: false, error: 'Empty SQL query' };
  }

  // Strip trailing semicolon from single statements
  sql = sql.replace(/;\s*$/, '');

  // Reject multiple statements (semicolon separating statements)
  if (sql.includes(';')) {
    return { valid: false, error: 'Multiple statements are not allowed' };
  }

  if (FORBIDDEN_PATTERN.test(sql)) {
    const keyword = sql.match(FORBIDDEN_PATTERN)![1].toUpperCase();
    return { valid: false, error: `${keyword} statements are not allowed` };
  }

  return { valid: true, sql };
}
