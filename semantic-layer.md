# Semantic Layer: HM Land Registry Price Paid Data

## Overview

The database contains **~31 million rows** of property sale transactions in England and Wales, sourced from the HM Land Registry Price Paid Data. It covers transactions from **January 1995 to December 2025**.

There is a single table: `property_sales` in the `public` schema.

## Table: property_sales

| Column           | Type        | Nullable | Description |
|------------------|-------------|----------|-------------|
| id               | bigint      | NOT NULL | Auto-generated primary key |
| transaction_id   | text        | NULL     | Unique transaction reference from Land Registry |
| price            | integer     | NOT NULL | Sale price in GBP (pounds sterling). Range: 1 to 900,000,000 |
| date_of_transfer | date        | NOT NULL | Date the sale completed. Range: 1995-01-01 to 2025-12-24 |
| postcode         | text        | NULL     | Full UK postcode (e.g. "SE19 3NF", "E16 1LG") |
| property_type    | char(1)     | NULL     | Type of property (see coded values below) |
| old_new          | char(1)     | NULL     | Whether the property was newly built at the time of sale |
| duration         | char(1)     | NULL     | Tenure type (see coded values below) |
| paon             | text        | NULL     | Primary Addressable Object Name (house number or name) |
| saon             | text        | NULL     | Secondary Addressable Object Name (flat/unit number) |
| street           | text        | NULL     | Street name |
| locality         | text        | NULL     | Locality or neighbourhood |
| town             | text        | NULL     | Town or city. **All values are UPPERCASE.** |
| district         | text        | NULL     | Local authority district. **All values are UPPERCASE.** |
| county           | text        | NULL     | County. **All values are UPPERCASE.** |
| ppd_category     | char(1)     | NULL     | Price Paid Data category (see coded values below) |

### Indexes

- Primary key on `id`
- `idx_ps_date` on `date_of_transfer`
- `idx_ps_town` on `town`
- `idx_ps_district` on `district`
- `idx_ps_county` on `county`
- `idx_ps_postcode` on `postcode`
- `idx_ps_property_type` on `property_type`
- `idx_ps_ppd_category` on `ppd_category`
- `idx_ps_date_category` on `(date_of_transfer, ppd_category)`
- `idx_ps_town_cat_price` on `(town, ppd_category) INCLUDE (price)` — index-only scan for aggregations filtered by town
- `idx_ps_price_desc` on `(price DESC)` — fast ORDER BY price DESC for superlative queries

## Coded Values

### property_type

| Code | Meaning        |
|------|----------------|
| D    | Detached       |
| S    | Semi-detached  |
| T    | Terraced       |
| F    | Flat / Maisonette |
| O    | Other          |

### old_new

| Code | Meaning              |
|------|----------------------|
| Y    | Newly built property |
| N    | Established (resale) |

### duration (tenure)

| Code | Meaning   |
|------|-----------|
| F    | Freehold  |
| L    | Leasehold |
| U    | Unknown   |

### ppd_category

| Code | Meaning |
|------|---------|
| A    | Standard Price Paid (single residential property sold at market value to a private buyer, ~29.2M records) |
| B    | Additional Price Paid (transfers under power of sale, repossessions, buy to let, commercial conversions, ~1.7M records) |

**Default to ppd_category = 'A'** for general queries (averages, medians, counts). But do NOT filter by ppd_category for superlative queries ("most expensive", "highest price", "record", "ever", "all time") because the top sales are often in category B.

### property_type = 'O' (Other)

Type 'O' represents commercial transactions, land deals, and non-residential sales. When the user asks about "houses", "homes", "residential", or "property" in a residential context, **exclude type 'O'** by filtering `property_type IN ('D','S','T','F')`. Only include 'O' if the user explicitly asks about commercial or all property types.

## Important Query Rules

1. **All text comparisons for town, district, and county must use UPPERCASE** since the data is stored in uppercase. Example: `WHERE town = 'LONDON'` not `WHERE town = 'London'`.

2. **Prices are integers in GBP.** Format with £ and commas in the interpretation, not in SQL.

3. **Use PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) for median calculations.** Average (AVG) can be skewed by extreme values.

4. **Always add LIMIT 100** to queries unless the user is asking for an aggregate (COUNT, AVG, SUM, etc.).

5. **For "London" queries**, use `town = 'LONDON'` or `county = 'GREATER LONDON'` depending on context. The town LONDON has ~2.3M records; the county GREATER LONDON has ~3.9M records (includes surrounding boroughs).

6. **Year filtering** uses `EXTRACT(YEAR FROM date_of_transfer) = YYYY` or `date_of_transfer BETWEEN 'YYYY-01-01' AND 'YYYY-12-31'`.

## Top Towns by Transaction Volume

LONDON (2.3M), MANCHESTER (508K), BRISTOL (474K), BIRMINGHAM (450K), NOTTINGHAM (406K), LEEDS (347K), LIVERPOOL (327K), SHEFFIELD (295K), LEICESTER (268K), SOUTHAMPTON (247K)

## Top Counties by Transaction Volume

GREATER LONDON (3.9M), GREATER MANCHESTER (1.4M), WEST YORKSHIRE (1.2M), WEST MIDLANDS (1.2M), KENT (878K), ESSEX (856K), HAMPSHIRE (803K), LANCASHIRE (708K), SURREY (689K), MERSEYSIDE (659K)

## Example Natural Language to SQL Mappings

**"What is the average house price in London?"**
```sql
SELECT AVG(price) AS average_price
FROM property_sales
WHERE town = 'LONDON' AND ppd_category = 'A'
```

**"What is the most expensive house ever sold in England?"**
```sql
SELECT price, date_of_transfer, paon, saon, street, town, district, county, property_type
FROM property_sales
WHERE property_type IN ('D','S','T','F')
ORDER BY price DESC
LIMIT 1
```

**"Compare flat prices in London with detached houses in Yorkshire"**
```sql
SELECT
  CASE
    WHEN town = 'LONDON' AND property_type = 'F' THEN 'London Flats'
    WHEN county = 'WEST YORKSHIRE' AND property_type = 'D' THEN 'Yorkshire Detached'
  END AS category,
  COUNT(*) AS total_sales,
  AVG(price) AS avg_price,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) AS median_price
FROM property_sales
WHERE ppd_category = 'A'
  AND (
    (town = 'LONDON' AND property_type = 'F')
    OR (county = 'WEST YORKSHIRE' AND property_type = 'D')
  )
GROUP BY category
```

**"What has happened to house prices since 2020?"**
```sql
SELECT
  EXTRACT(YEAR FROM date_of_transfer) AS year,
  COUNT(*) AS transactions,
  AVG(price) AS avg_price,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) AS median_price
FROM property_sales
WHERE date_of_transfer >= '2020-01-01' AND ppd_category = 'A'
GROUP BY year
ORDER BY year
```

**"Which postcode has the most transactions?"**
```sql
SELECT postcode, COUNT(*) AS transaction_count
FROM property_sales
WHERE ppd_category = 'A' AND postcode IS NOT NULL
GROUP BY postcode
ORDER BY transaction_count DESC
LIMIT 10
```

**"What is the median price of a terraced house in Manchester in 2023?"**
```sql
SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY price) AS median_price
FROM property_sales
WHERE town = 'MANCHESTER'
  AND property_type = 'T'
  AND ppd_category = 'A'
  AND EXTRACT(YEAR FROM date_of_transfer) = 2023
```

**"How many new builds were sold last year?"**
```sql
SELECT COUNT(*) AS new_builds_sold
FROM property_sales
WHERE old_new = 'Y'
  AND ppd_category = 'A'
  AND EXTRACT(YEAR FROM date_of_transfer) = EXTRACT(YEAR FROM CURRENT_DATE) - 1
```

**"Show me the cheapest freehold properties in Surrey"**
```sql
SELECT price, date_of_transfer, paon, street, town, district, property_type
FROM property_sales
WHERE county = 'SURREY'
  AND duration = 'F'
  AND ppd_category = 'A'
ORDER BY price ASC
LIMIT 10
```

**"Where are the hidden gems? Cheap areas growing fastest."**
```sql
WITH prices_2020 AS (
  SELECT town, ROUND(AVG(price)::numeric, 0) AS avg_2020
  FROM property_sales
  WHERE ppd_category = 'A' AND EXTRACT(YEAR FROM date_of_transfer) = 2020
  GROUP BY town HAVING COUNT(*) >= 100
),
prices_now AS (
  SELECT town, ROUND(AVG(price)::numeric, 0) AS avg_now
  FROM property_sales
  WHERE ppd_category = 'A' AND EXTRACT(YEAR FROM date_of_transfer) = 2025
  GROUP BY town HAVING COUNT(*) >= 200
)
SELECT n.town, n.avg_now AS current_price, p.avg_2020 AS price_2020,
  ROUND(((n.avg_now - p.avg_2020)::numeric / p.avg_2020 * 100), 0) AS growth_pct
FROM prices_now n JOIN prices_2020 p ON n.town = p.town
WHERE n.avg_now < 250000
ORDER BY growth_pct DESC
LIMIT 10
```
