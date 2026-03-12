# land-registry-nlq

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/tests-209_passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

Natural language queries over 31 million UK property transactions.

Ask questions in plain English, get answers from every property sale in England & Wales since 1995.

```
$ npx tsx src/index.ts "What is the most expensive house ever sold in England?"

£900,000,000 — a property sold on 15 June 2023.
```

## Built on video

This project was built live on [The LLM Whisperer](https://www.youtube.com/@thellmwhisperer) YouTube channel:

| Episode | Video | What it covers |
|---------|-------|----------------|
| **Ep 3** | [I Built an AI App That Queries 31 Million Records in Plain English](https://youtu.be/mxUErtQldW8) | Full build from zero: NL-to-SQL pipeline, prompt injection attack, AST-based security fix |
| **Ep 4** | [Cybersecurity Expert Hacked My AI App](https://youtu.be/CurXpds_tAQ) | 6 security layers: input validation, prompt hardening, AST upgrade, DB hardening, output sanitization, middleware |

## How it works

A seven-stage pipeline turns a question into an answer:

```
 "What's the average house price in London?"
                    │
                    ▼
 ┌──────────────────────────────────┐
 │  1. Input Validation             │
 │  Length cap (500 chars), prompt   │
 │  injection blocklist (16 regex)  │
 └───────────────┬──────────────────┘
                 ▼
 ┌──────────────────────────────────┐
 │  2. Prompt Hardening             │
 │  XML structure, escapeXml,       │
 │  post-instruction reinforcement  │
 └───────────────┬──────────────────┘
                 ▼
 ┌──────────────────────────────────┐
 │  3. SQL Generation               │
 │  Claude Haiku + semantic layer   │
 │  → raw SQL (or REFUSE)          │
 └───────────────┬──────────────────┘
                 ▼
 ┌──────────────────────────────────┐
 │  4. SQL Validation               │
 │  Regex pre-check + AST via       │
 │  libpg-query (table allowlist,   │
 │  function blocklist, LIMIT)      │
 └───────────────┬──────────────────┘
                 ▼
 ┌──────────────────────────────────┐
 │  5. SQL Execution                │
 │  Cursor-based, max 1000 rows,    │
 │  read-only role, 10s timeout     │
 └───────────────┬──────────────────┘
                 ▼
 ┌──────────────────────────────────┐
 │  6. Interpretation               │
 │  Claude Haiku → plain English    │
 │  (includes truncation notice)    │
 └───────────────┬──────────────────┘
                 ▼
 ┌──────────────────────────────────┐
 │  7. Response                     │
 │  { answer, sql, rows, truncated }│
 │  Generic errors to client        │
 └──────────────────────────────────┘
```

## Security model

The project's core thesis: **an LLM generating SQL is a security risk, so you validate with multiple layers that don't trust each other.**

### Layer 1 — Input validation

Blocks malicious input before it reaches the LLM:

- 500 character length cap
- 16 regex patterns: prompt injection (`ignore previous instructions`), jailbreaks (`you are now`, `DAN mode`), role hijacking (`act as database admin`), delimiter injection (triple backticks, `[INST]`, `<<SYS>>`), encoding attacks (`base64`, hex payloads)
- Generic "Invalid question" error — no information leakage about which pattern matched

### Layer 2 — Prompt hardening

Structured prompt that resists injection:

- XML-tagged sections: `<schema>`, `<rules>`, `<examples>`
- User input wrapped in `<user_query>` with `escapeXml()` (escapes `&`, `<`, `>`)
- `<reinforcement>` block after the user query restates constraints
- REFUSE instruction for off-topic questions

### Layer 3 — SQL validation (regex + AST)

Two-pass validation of LLM-generated SQL:

| Check | What it does |
|-------|-------------|
| **Keyword pre-check** | Blocks `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`, `CREATE`, `GRANT`, `REVOKE`, `UNION` |
| **REFUSE detection** | Catches the LLM's refusal before it reaches the parser |
| **Table allowlist** | Only `property_sales` — any other table is rejected |
| **Schema blocklist** | `pg_catalog.*`, `information_schema.*` → rejected |
| **Function blocklist** | `pg_sleep`, `pg_read_file`, `pg_read_binary_file`, `lo_import`, `lo_export`, `dblink`, `dblink_exec`, `dblink_connect` |
| **Mutation detection** | Full AST traversal for INSERT, UPDATE, DELETE, MERGE, SELECT INTO |
| **LIMIT injection** | Injects `LIMIT 1001` on non-aggregate queries (1001 = 1000 + 1 to detect truncation) |
| **LIMIT clamping** | Existing LIMIT >= 1000 or `ALL`/`NULL` clamped to 1001 |

### Layer 4 — Database hardening

The app connects as `nlq_readonly`, a locked-down PostgreSQL role:

```sql
-- What nlq_readonly CAN do:
SELECT on property_sales

-- What nlq_readonly CANNOT do:
INSERT, UPDATE, DELETE, CREATE TABLE, CREATE TEMP TABLE,
access pg_catalog.pg_authid, access information_schema
```

- `statement_timeout = 10s` — kills runaway queries
- `log_min_duration_statement = 5s` — flags slow queries
- Migration is transactional (`BEGIN/COMMIT`) and derives owner from `current_user`

### Layer 5 — Output sanitization

- Client gets generic errors only: `"Invalid question"` (400) or `"Internal server error"` (500)
- No PostgreSQL error details, table names, or column names leak to the client
- Server-side structured JSON logging with question, error, timestamp
- Stack traces logged only on 5xx errors

### Layer 6 — Middleware

- **helmet** — security headers (X-Content-Type-Options, X-Frame-Options, etc.)
- **CORS** — fail-closed: requires `CORS_ORIGIN` env var, blocks all browser origins if unset
- **Rate limiting** — configurable (default 15 req/min), JSON 429 response, skips OPTIONS preflight
- **Body size** — 10kb limit (413 on oversized payloads)
- **Trust proxy** — configurable via `TRUST_PROXY` (boolean, hop count, IP/CIDR)

## Quick start

### Prerequisites

- Node.js 20+
- PostgreSQL 15+ with the Land Registry dataset loaded
- An [Anthropic API key](https://console.anthropic.com/)

### Database setup

```bash
# Load the dataset (see Data section below)
# Then run the hardening migration as the database owner:
psql -U your_user -d land_registry -f sql/001-create-readonly-role.sql
```

### App setup

```bash
npm install
```

```bash
export DATABASE_URL="postgresql://nlq_readonly:your-secret@localhost:5432/land_registry"
export ANTHROPIC_API_KEY="sk-ant-..."
export CORS_ORIGIN="http://localhost:5173"
```

### Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | yes | — | PostgreSQL connection string (use `nlq_readonly` role) |
| `ANTHROPIC_API_KEY` | yes | — | Claude API key |
| `CORS_ORIGIN` | yes | — | Allowed browser origin. No default — CORS blocks all origins if unset |
| `PORT` | no | `3000` | Server port |
| `RATE_LIMIT` | no | `15` | Max requests per minute |
| `TRUST_PROXY` | no | `false` | Express trust proxy (`true`, hop count, IP/CIDR) |

## API

### CLI

```bash
npx tsx src/index.ts "How many houses were sold in Manchester in 2024?"
```

Returns JSON with `question`, `sql`, `rows`, and `interpretation`.

### HTTP server

```bash
npm run dev    # watch mode
npm start      # production
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
  "interpretation": "The average house price in London is approximately £523,000.",
  "truncated": false
}
```

**Status codes:** 400 (invalid/blocked question), 413 (payload too large), 429 (rate limited), 500 (server error).

## Data

**Source:** [HM Land Registry Price Paid Data](https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads) — ~31 million transactions from January 1995 to December 2025.

Single table: `property_sales` with columns for price, date, address (postcode, street, town, district, county), property type (Detached/Semi/Terraced/Flat/Other), tenure (Freehold/Leasehold), and sale category.

All location fields (`town`, `district`, `county`) are stored in **UPPERCASE**.

See [`semantic-layer.md`](semantic-layer.md) for the complete schema, coded values, indexes, and example queries.

## Testing

209 tests across 12 files, built TDD:

```bash
npm test                    # unit tests (209 passing)
TEST_DB=1 npm test          # + integration tests against real DB (9 additional)
```

| Module | Tests | Covers |
|--------|------:|--------|
| AST validator | 69 | Table/schema/function blocklist, CTEs, LIMIT injection/clamping, aggregate detection, mutations, byte-offset safety |
| Input validator | 41 | Injection patterns (16 regex), length cap, edge cases, false positive resistance |
| Prompt builder | 23 | XML structure, escapeXml (& < >), tag injection prevention, reinforcement block, dynamic year |
| Server | 20 | Error classification (400/500), generic errors, structured logging, stack omission on 4xx, CORS, trust proxy, rate limit |
| SQL executor | 13 | Cursor lifecycle (DECLARE/FETCH/CLOSE), truncation detection, read-only transactions, pool release |
| Regex validator | 24 | Forbidden keywords, code fences, REFUSE detection |
| Middleware | 8 | Helmet headers, CORS enforcement, rate limiting, body size, OPTIONS skip |
| Pipeline | 3 | End-to-end orchestration |
| DB hardening | 9 | Read-only role permissions, statement_timeout, pg_catalog access (requires `TEST_DB=1`) |
| Interpreter | 2 | Truncation notice, result summarization |

## Stack

| Dependency | Purpose |
|-----------|---------|
| `@anthropic-ai/sdk` | Claude Haiku — SQL generation + interpretation |
| `libpg-query` | PostgreSQL 17 parser compiled to WASM — AST validation |
| `pg` | PostgreSQL connection pool |
| `express` | HTTP server (v5) |
| `helmet` | Security headers |
| `cors` | Cross-origin resource sharing |
| `express-rate-limit` | Request rate limiting |
| `vitest` | Test framework |
| `typescript` | Type safety |

## License

MIT

### Data attribution

Contains HM Land Registry data © Crown copyright and database right 2021. Licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
