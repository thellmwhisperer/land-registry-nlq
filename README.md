# Land Registry NL-to-SQL

Natural language to SQL pipeline over 31 million UK property transactions from HM Land Registry.

Ask questions in plain English. An LLM generates SQL, executes it against PostgreSQL, and interprets the results.

## Stack

- TypeScript (ESM)
- Express server
- Claude Haiku 4.5 (SQL generation + result interpretation)
- PostgreSQL 17 + libpg-query (AST-based SQL validation)
- Vitest

## Security

Two-layer SQL validation:

1. **Regex validator** — blocks DML/DDL statements (INSERT, DROP, etc.)
2. **AST validator** — parses SQL with the real PostgreSQL 17 parser (libpg-query compiled to WASM), enforces a table allowlist, rejects system catalog access, blocks dangerous functions (`pg_sleep`, `pg_read_file`, `dblink`), and auto-injects LIMIT on unbounded queries

## Setup

```bash
npm install
```

### Environment

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/land_registry"
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Database

Load the [HM Land Registry Price Paid Data](https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads) into PostgreSQL. The app expects a single `property_sales` table (see `semantic-layer.md` for the schema).

## Usage

### Server

```bash
npx tsx src/server.ts
```

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the average house price in London?"}'
```

### CLI

```bash
npx tsx src/index.ts "What is the most expensive house ever sold in England?"
```

## Tests

```bash
npx vitest run
```

## Data

Contains HM Land Registry data Crown copyright and database right 2021. Licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
