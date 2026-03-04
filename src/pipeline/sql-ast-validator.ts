import { loadModule, parseSync } from 'libpg-query';

export type ValidationResult =
  | { valid: true; sql: string }
  | { valid: false; error: string };

const ALLOWED_TABLES = new Set(['property_sales']);

const FORBIDDEN_FUNCTIONS = new Set([
  'pg_sleep',
  'pg_read_file',
  'dblink',
  'lo_import',
  'lo_export',
]);

const AGGREGATE_FUNCTIONS = new Set([
  'avg',
  'count',
  'sum',
  'min',
  'max',
  'percentile_cont',
  'percentile_disc',
  'array_agg',
  'string_agg',
]);

const MUTATION_NODES = new Set([
  'InsertStmt',
  'UpdateStmt',
  'DeleteStmt',
  'MergeStmt',
]);

let moduleLoaded = false;

async function ensureModule(): Promise<void> {
  if (!moduleLoaded) {
    await loadModule();
    moduleLoaded = true;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectCTENames(node: any): Set<string> {
  const names = new Set<string>();
  if (node?.SelectStmt?.withClause?.ctes) {
    for (const cte of node.SelectStmt.withClause.ctes) {
      if (cte.CommonTableExpr?.ctename) {
        names.add(cte.CommonTableExpr.ctename);
      }
    }
  }
  return names;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasMutationNodes(node: any): boolean {
  if (node === null || node === undefined || typeof node !== 'object') return false;

  if (Array.isArray(node)) {
    return node.some((item) => hasMutationNodes(item));
  }

  for (const key of Object.keys(node)) {
    if (MUTATION_NODES.has(key)) return true;
    if (hasMutationNodes(node[key])) return true;
  }

  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectFromAST(node: any, tables: { schema?: string; name: string }[], functions: string[]): void {
  if (node === null || node === undefined || typeof node !== 'object') return;

  if (node.RangeVar) {
    const rv = node.RangeVar;
    tables.push({
      schema: rv.schemaname,
      name: rv.relname,
    });
  }

  if (node.FuncCall) {
    const fc = node.FuncCall;
    if (fc.funcname) {
      for (const part of fc.funcname) {
        if (part.String?.sval) {
          functions.push(part.String.sval.toLowerCase());
        }
      }
    }
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectFromAST(item, tables, functions);
    }
  } else {
    for (const key of Object.keys(node)) {
      collectFromAST(node[key], tables, functions);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasAggregateFunctions(targetList: any[]): boolean {
  const json = JSON.stringify(targetList);
  for (const fn of AGGREGATE_FUNCTIONS) {
    if (json.toLowerCase().includes(`"sval":"${fn}"`)) return true;
  }
  return false;
}

function isAggregateQuery(stmt: Record<string, unknown>): boolean {
  const targetList = stmt.targetList as Array<Record<string, unknown>> | undefined;
  if (!targetList) return false;

  const hasGroupBy = Array.isArray(stmt.groupClause) && stmt.groupClause.length > 0;
  if (hasGroupBy) return true;

  return hasAggregateFunctions(targetList);
}

export function validateSQLWithAST(sql: string): ValidationResult {
  if (!moduleLoaded) {
    throw new Error('Call initASTValidator() before using validateSQLWithAST');
  }

  let parsed;
  try {
    parsed = parseSync(sql);
  } catch {
    return { valid: false, error: 'Failed to parse SQL' };
  }

  const stmts = parsed.stmts;

  if (!stmts || stmts.length === 0) {
    return { valid: false, error: 'Empty SQL query' };
  }

  if (stmts.length > 1) {
    return { valid: false, error: 'Multiple statements are not allowed' };
  }

  const stmtWrapper = stmts[0].stmt;

  if (!stmtWrapper.SelectStmt) {
    return { valid: false, error: 'Only SELECT statements are allowed' };
  }

  if (hasMutationNodes(stmtWrapper)) {
    return { valid: false, error: 'Write operations are not allowed' };
  }

  const selectStmt = stmtWrapper.SelectStmt;

  if (selectStmt.intoClause) {
    return { valid: false, error: 'SELECT INTO is not allowed' };
  }

  const cteNames = collectCTENames(stmtWrapper);

  const tables: { schema?: string; name: string }[] = [];
  const functions: string[] = [];
  collectFromAST(stmtWrapper, tables, functions);

  for (const fn of functions) {
    if (FORBIDDEN_FUNCTIONS.has(fn)) {
      return { valid: false, error: `Forbidden function: ${fn}` };
    }
  }

  for (const table of tables) {
    const schema = table.schema;
    const name = table.name;

    if (cteNames.has(name) && !schema) {
      continue;
    }

    if (schema) {
      return {
        valid: false,
        error: `Query rejected. Table ${schema}.${name} is not in the allowed list.`,
      };
    }

    if (!ALLOWED_TABLES.has(name)) {
      return {
        valid: false,
        error: `Query rejected. Table ${name} is not in the allowed list.`,
      };
    }
  }

  const hasLimit = selectStmt.limitCount !== undefined;
  const aggregate = isAggregateQuery(selectStmt);

  if (!hasLimit && !aggregate) {
    return { valid: true, sql: `${sql} LIMIT 1000` };
  }

  return { valid: true, sql };
}

export async function initASTValidator(): Promise<void> {
  await ensureModule();
}
