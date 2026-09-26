# FlightSearch — Distributed Query & Indexing Service on DynamoDB

A flight/booking search service built to demonstrate deliberate partition-key
and index design for query performance at scale, as a companion piece to
SkyReserve (EC2/RDS/Redis) — this project targets the "build distributed
storage, index, and query systems" side of NoSQL/distributed design rather
than the relational side already covered there.

## Why single-table NoSQL design, not "one table per entity"

A relational instinct here would be a `flights` table plus secondary indexes
bolted on afterward. DynamoDB is designed the opposite way: you enumerate the
access patterns first, then design keys that make each one a `Query`, not a
`Scan`. Section 1 of [`design/SCHEMA_DESIGN.md`](design/SCHEMA_DESIGN.md)
lists the four real access patterns this service needs to answer, and every
key decision below traces back to one of them.

## Schema summary

| | Key | Serves |
|---|---|---|
| Base table | `PK = ROUTE#<origin>-<destination>`, `SK = DATE#<date>#FLIGHT#<id>` | route + date range search |
| GSI1 | `GSI1PK/SK = FLIGHT#<id>` | direct lookup by flight ID |
| GSI2 | `GSI2PK = ROUTE#..#CLASS#<class>`, `GSI2SK = PRICE#<padded>#DATE#<date>` | price range + seat class filter, sorted cheapest-first |

Full reasoning, including why `PK = DATE` alone would create hot partitions
and why each GSI is necessary (not just convenient), is in
[`design/SCHEMA_DESIGN.md`](design/SCHEMA_DESIGN.md).

## Project layout

```
flightsearch/
├── design/SCHEMA_DESIGN.md      — full key design + reasoning
├── seed/
│   ├── generate-seed-data.js    — synthetic data generator (100k+ records)
│   ├── create-table.js          — creates table + both GSIs, on-demand billing
│   └── load-seed-data.js        — batch-writes generated data into DynamoDB
├── api/
│   ├── server.js                — Express app entry point
│   ├── lib/dynamo.js            — DynamoDB Document Client setup
│   ├── lib/cursor.js            — opaque cursor encode/decode for pagination
│   └── routes/
│       ├── search.js            — GET /search   (base table, route+date)
│       ├── filter.js            — GET /filter   (GSI2, price+class)
│       └── flight.js            — GET /flight/:id (GSI1, direct lookup)
└── load-test/k6-script.js       — 50 → 200 → 500 VU ramp, p95 per endpoint
```

## Running it end to end

```bash
npm install

# 1. Create the table (on-demand capacity mode, per the project brief —
#    no RCU/WCU guessing for a side project at this volume)
export AWS_REGION=us-east-1   # your region
npm run create-table

# 2. Generate and load 100k synthetic flights
npm run generate-seed         # writes seed/flights.ndjson
npm run load-seed             # batch-writes into DynamoDB

# 3. Start the API
npm start                     # listens on :3000

# 4. Load test it (separate terminal, requires k6 installed)
npm run load-test
```

## API

**`GET /search`** — route + date range (base table `Query`)
```
/search?origin=SIN&destination=JFK&startDate=2026-10-01&endDate=2026-10-07&limit=20&cursor=<opaque>
```

**`GET /filter`** — price range + seat class within a route (GSI2 `Query`)
```
/filter?origin=SIN&destination=JFK&seatClass=ECONOMY&maxPrice=400&minPrice=100&limit=20
```

**`GET /flight/:flightId`** — direct lookup (GSI1 `Query`)
```
/flight/FL-1000042
```

All three return `nextCursor` when more results exist — pass it back as
`?cursor=...` for the next page. This is real DynamoDB `LastEvaluatedKey`
cursoring, not offset/limit: DynamoDB has no concept of "page 3," so an
offset-based API would require reading and discarding every prior page's
worth of items server-side to fake it, which defeats the purpose of a
partition-scoped query in the first place.

## Load test results

*(This section is intentionally left for you to fill in — the same rule as
the SkyReserve project applies: no invented numbers. Run `npm run load-test`
against your own deployed table and API, and drop the k6 summary output's
p95 figures in here per stage.)*

| Concurrency | `/search` p95 | `/filter` p95 | `/flight/:id` p95 |
|---|---|---|---|
| 50 VUs  | — | — | — |
| 200 VUs | — | — | — |
| 500 VUs | — | — | — |

Because DynamoDB is fully managed, this test is really validating the API
layer and query design — Express overhead, JSON marshalling, whether the
queries stay partition-scoped under load — not whether infrastructure falls
over. If `/flight/:id` (a keyed GSI lookup) is meaningfully faster and flatter
across the concurrency ramp than `/search` or `/filter` (range queries), that
difference is itself worth calling out in this section: it's evidence the key
design, not the server, is what's driving latency.

## What was deliberately avoided

- **No `Scan` on the main query path.** Every endpoint is a `Query` against
  either the base table's PK/SK or one of the two GSIs.
- **No `PK = DATE`.** Would concentrate near-term-date search traffic (the
  overwhelming majority of real searches) onto a handful of hot partitions.
  See `design/SCHEMA_DESIGN.md` §2.
- **No offset-based pagination.** `LastEvaluatedKey`-based cursors only.

## Resume bullet (fill in once real numbers exist)

> Designed and built a distributed flight-search service on DynamoDB using
> single-table design with 2 GSIs to serve 3 access patterns without table
> scans; seeded 100k+ records and load-tested to 500 concurrent users,
> sustaining p95 < ___ ms on [endpoint].
