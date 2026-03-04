import { loadModule, parseSync } from 'libpg-query';
import type {
  ParseResult,
  Node,
  SelectStmt,
  RangeVar,
  FuncCall,
  CommonTableExpr,
} from '@pgsql/types';

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

type ASTNode = Record<string, unknown>;

let moduleLoaded = false;

async function ensureModule(): Promise<void> {
  if (!moduleLoaded) {
    await loadModule();
    moduleLoaded = true;
  }
}

function collectCTENames(stmtNode: Node): Set<string> {
  const names = new Set<string>();
  if ('SelectStmt' in stmtNode && stmtNode.SelectStmt) {
    const ctes = stmtNode.SelectStmt.withClause?.ctes;
    if (ctes) {
      for (const cte of ctes) {
        if ('CommonTableExpr' in cte && cte.CommonTableExpr) {
          const cteName = (cte.CommonTableExpr as CommonTableExpr).ctename;
          if (cteName) {
            names.add(cteName);
          }
        }
      }
    }
  }
  return names;
}

function hasMutationNodes(node: ASTNode | ASTNode[]): boolean {
  if (node === null || node === undefined || typeof node !== 'object') return false;

  if (Array.isArray(node)) {
    return node.some((item) => hasMutationNodes(item as ASTNode));
  }

  for (const key of Object.keys(node)) {
    if (MUTATION_NODES.has(key)) return true;
    if (hasMutationNodes((node as Record<string, ASTNode>)[key])) return true;
  }

  return false;
}

function collectFromAST(
  node: ASTNode,
  tables: { schema?: string; name: string }[],
  functions: string[],
): void {
  if (node === null || node === undefined || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) {
      collectFromAST(item as ASTNode, tables, functions);
    }
    return;
  }

  const record = node as Record<string, ASTNode>;

  if ('RangeVar' in node) {
    const rv = (node as { RangeVar: RangeVar }).RangeVar;
    tables.push({
      schema: rv.schemaname,
      name: rv.relname!,
    });
  }

  if ('FuncCall' in node) {
    const fc = (node as { FuncCall: FuncCall }).FuncCall;
    if (fc.funcname) {
      for (const part of fc.funcname) {
        if ('String' in part) {
          const sval = (part as { String: { sval?: string } }).String.sval;
          if (sval) {
            functions.push(sval.toLowerCase());
          }
        }
      }
    }
  }

  for (const key of Object.keys(record)) {
    collectFromAST(record[key], tables, functions);
  }
}

function hasAggregateFuncCall(node: ASTNode | ASTNode[]): boolean {
  if (node === null || node === undefined || typeof node !== 'object') return false;

  if (Array.isArray(node)) {
    return node.some((item) => hasAggregateFuncCall(item as ASTNode));
  }

  const record = node as Record<string, ASTNode>;

  if ('FuncCall' in node) {
    const fc = (node as { FuncCall: FuncCall }).FuncCall;
    if (fc.funcname) {
      for (const part of fc.funcname) {
        if ('String' in part) {
          const sval = (part as { String: { sval?: string } }).String.sval;
          if (sval && AGGREGATE_FUNCTIONS.has(sval.toLowerCase())) {
            return true;
          }
        }
      }
    }
    if (fc.agg_within_group || fc.agg_order || fc.agg_distinct) {
      return true;
    }
  }

  for (const key of Object.keys(record)) {
    if (hasAggregateFuncCall(record[key])) return true;
  }

  return false;
}

function isAggregateQuery(stmt: SelectStmt): boolean {
  if (!stmt.targetList) return false;

  const hasGroupBy = Array.isArray(stmt.groupClause) && stmt.groupClause.length > 0;
  if (hasGroupBy) return true;

  return hasAggregateFuncCall(stmt.targetList as ASTNode[]);
}

export function validateSQLWithAST(sql: string): ValidationResult {
  if (!moduleLoaded) {
    throw new Error('Call initASTValidator() before using validateSQLWithAST');
  }

  let parsed: ParseResult;
  try {
    parsed = parseSync(sql) as ParseResult;
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
  if (!stmtWrapper) {
    return { valid: false, error: 'Empty SQL query' };
  }

  if (!('SelectStmt' in stmtWrapper)) {
    return { valid: false, error: 'Only SELECT statements are allowed' };
  }

  if (hasMutationNodes(stmtWrapper as ASTNode)) {
    return { valid: false, error: 'Write operations are not allowed' };
  }

  const selectStmt = (stmtWrapper as { SelectStmt: SelectStmt }).SelectStmt;

  if (selectStmt.intoClause) {
    return { valid: false, error: 'SELECT INTO is not allowed' };
  }

  const cteNames = collectCTENames(stmtWrapper);

  const tables: { schema?: string; name: string }[] = [];
  const functions: string[] = [];
  collectFromAST(stmtWrapper as ASTNode, tables, functions);

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
    const trimmed = sql.replace(/--[^\n]*$/, '').trimEnd().replace(/;\s*$/, '');
    const bounded = `${trimmed} LIMIT 1000`;

    try {
      const check = parseSync(bounded) as ParseResult;
      const checkStmt = check.stmts?.[0]?.stmt;
      if (!checkStmt || !('SelectStmt' in checkStmt) || !(checkStmt as { SelectStmt: SelectStmt }).SelectStmt.limitCount) {
        return { valid: false, error: 'Failed to inject LIMIT safely' };
      }
    } catch {
      return { valid: false, error: 'Failed to inject LIMIT safely' };
    }

    return { valid: true, sql: bounded };
  }

  return { valid: true, sql };
}

export async function initASTValidator(): Promise<void> {
  await ensureModule();
}
