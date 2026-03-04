# land-registry-nlq

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/tests-81_passing-brightgreen)
![License](https://img.shields.io/badge/license-ISC-blue)

Natural language queries over 31 million UK property transactions.

Ask questions in plain English, get answers from every property sale in England & Wales since 1995.

```
$ npx tsx src/index.ts "What is the most expensive house ever sold in England?"

£900,000,000 — a property sold on 15 June 2023.
```

> Built for the video **I Hacked My AI App in 30 Seconds (and Fixed It with Another AI)** <!-- TODO: add YouTube link when published -->

## How it works

A five-stage pipeline turns a question into an answer:

```
 "What's the average house price in London?"
                    │
                    ▼
 ┌──────────────────────────────────┐
 │  1. SQL Generation               │
 │  Claude Haiku 4.5 + semantic     │
 │  layer → raw SQL                 │
 └───────────────┬──────────────────┘
                 ▼
 ┌──────────────────────────────────┐
 │  2. Regex Validation             │
 │  Block INSERT, DROP, ALTER,      │
 │  DELETE, GRANT, TRUNCATE…        │
 └───────────────┬──────────────────┘
                 ▼
 ┌──────────────────────────────────┐
 │  3. AST Validation               │
 │  PostgreSQL 17 parser (WASM)     │
 │  Table allowlist, function       │
 │  blocklist, mutation detection,  │
 │  auto-inject LIMIT               │
 └───────────────┬──────────────────┘
                 ▼
 ┌──────────────────────────────────┐
 │  4. SQL Execution                │
 │  READ ONLY transaction           │
 │  10s statement timeout           │
 └───────────────┬──────────────────┘
                 ▼
 ┌──────────────────────────────────┐
 │  5. Interpretation               │
 │  Claude Haiku 4.5 → plain        │
 │  English summary                 │
 └──────────────────────────────────┘
```

## Security model

The project's core thesis: **an LLM generating SQL is a security risk, so you validate with a second layer that doesn't trust the first.**

### Layer 1 — Regex validator

Fast rejection of obvious DML/DDL before parsing:

- Blocks `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`
- Strips markdown code fences and trailing semicolons
- Case-insensitive matching

### Layer 2 — AST validator

Deep inspection using PostgreSQL 17's native parser (`libpg-query` compiled to WASM):

| Check | What it does |
|-------|-------------|
| **Table allowlist** | Only `property_sales` — any other table is rejected |
| **System catalog block** | `pg_catalog.*`, `information_schema.*` → rejected |
| **Function blocklist** | `pg_sleep`, `pg_read_file`, `lo_import`, `lo_export`, `dblink` |
| **Mutation detection** | Traverses the full AST for INSERT, UPDATE, DELETE, MERGE, SELECT INTO |
| **Auto LIMIT** | Injects `LIMIT 1000` on non-aggregate queries without one |

### Execution sandbox

- `BEGIN READ ONLY` transaction
- `SET LOCAL statement_timeout = '10s'`
- Connection released to pool after every query

## Quick start

### Prerequisites

- Node.js 18+
- PostgreSQL with the Land Registry dataset loaded
- An [Anthropic API key](https://console.anthropic.com/)

### Setup

```bash
npm install
```

```bash
export DATABASE_URL="postgresql://user:password@localhost:5432/land_registry"
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Load data

Download the [HM Land Registry Price Paid Data](https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads) and import it into PostgreSQL. The app expects a single `property_sales` table — see [`semantic-layer.md`](semantic-layer.md) for the full schema.

## API

### CLI

```bash
npx tsx src/index.ts "How many houses were sold in Manchester in 2024?"
```

Returns JSON with `question`, `sql`, `rows`, and `interpretation`.

### HTTP server

```bash
npx tsx src/server.ts
# Listening on http://localhost:3000
```

```bash
curl -s http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is the average house price in London?"}' | jq
```

```json
{
  "question": "What is the average house price in London?",
  "sql": "SELECT AVG(price) AS average_price FROM property_sales WHERE town = 'LONDON' AND ppd_category = 'A'",
  "rows": [{ "average_price": 523000 }],
  "interpretation": "The average house price in London is approximately £523,000."
}
```

**Errors:** 400 for invalid questions or blocked SQL, 500 for runtime failures.

## Data

**Source:** HM Land Registry Price Paid Data — ~31 million transactions from January 1995 to December 2025.

Single table: `property_sales` with columns for price, date, address (postcode, street, town, district, county), property type (Detached/Semi/Terraced/Flat/Other), tenure (Freehold/Leasehold), and sale category.

All location fields (`town`, `district`, `county`) are stored in **UPPERCASE**.

See [`semantic-layer.md`](semantic-layer.md) for the complete schema, coded values, indexes, and example queries.

## Testing

81 tests across 7 files, built TDD:

```bash
npm test
```

| Module | Tests | Covers |
|--------|------:|--------|
| AST validator | 35 | Table allowlist, function blocklist, CTEs, LIMIT injection, mutations |
| Regex validator | 24 | Forbidden keywords, code fences, edge cases |
| Prompt builder | 8 | Semantic layer embedding, few-shot examples |
| SQL executor | 5 | Read-only transactions, timeouts, pool release |
| SQL generator | 4 | LLM calls, code fence stripping |
| Pipeline | 3 | End-to-end orchestration, system catalog rejection |
| Interpreter | 2 | Result summarization, zero-row handling |

## Stack

| Dependency | Purpose |
|-----------|---------|
| `@anthropic-ai/sdk` | Claude Haiku 4.5 — SQL generation + interpretation |
| `libpg-query` | PostgreSQL 17 parser compiled to WASM — AST validation |
| `pg` | PostgreSQL connection pool |
| `express` | HTTP server |
| `vitest` | Test framework |
| `typescript` | Type safety |

## License

ISC

### Data attribution

Contains HM Land Registry data © Crown copyright and database right 2021. Licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
