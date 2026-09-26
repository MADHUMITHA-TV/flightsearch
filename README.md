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

Measured with k6, table pre-seeded with 100k records, on-demand billing mode.

| Concurrency | `/search` p95 | `/filter` p95 | `/flight/:id` p95 | Success rate |
|---|---|---|---|---|
| 20 VUs  | 1.34s  | 639ms | 642ms | 100.00% |
| 150 VUs | 1.39s  | 1.39s | 1.36s | 99.81% (45,844 / 45,930) |
| 500 VUs | — | — | — | Failed — see below |

Because DynamoDB is fully managed, this test is really validating the API
layer and query design — Express overhead, JSON marshalling, whether the
queries stay partition-scoped under load — not whether infrastructure falls
over. All three endpoints landed within a similar band at each concurrency
level rather than the keyed `/flight/:id` lookup pulling clearly ahead of the
range queries (`/search`, `/filter`) the way its access pattern would predict
at larger scale; see "Test environment limitations" below for why.

### 500 VU ramp: reproducible failure, and why

The 500-VU stage (per the original 50→200→500 brief) was attempted three
times and failed consistently with widespread request timeouts, once ruling
out an unrelated transient DNS blip on one attempt. This was not a DynamoDB
or schema failure — the server logged no DynamoDB errors or throttling
during the failed runs. The load generator (k6) and the API server were run
on the same single laptop, competing for the same CPU, memory, and network
stack; k6 alone spawning 500 concurrent virtual users is a meaningful load
on a laptop even before the target server does any work. 150 VUs sustained
a 99.81% success rate on the same hardware, so the ceiling here reflects the
test environment, not the service under test.

**What this means for the design being validated:** the schema and API
correctly served every query pattern at the concurrency levels the test
environment could generate cleanly. Confirming behavior at true 500-VU
concurrency would need the load generator and API decoupled onto separate
machines (e.g., k6 run from a small EC2 instance or a second machine against
the deployed API), which is a natural next step rather than a gap in the
current result.

### Test environment limitations

- **Client (Chennai) to `us-east-1` (Virginia) round-trip time** puts a
  ~285-290ms floor under every request, including the keyed `/flight/:id`
  lookup, which masks how much of the remaining latency is DynamoDB query
  cost versus network transit. A same-region deployment (API and load
  generator both in-region) would isolate query cost more precisely.
- **Load generator and API shared one machine**, which is why 500 VUs
  produced contention rather than a clean DynamoDB-side signal (see above).

## What was deliberately avoided

- **No `Scan` on the main query path.** Every endpoint is a `Query` against
  either the base table's PK/SK or one of the two GSIs.
- **No `PK = DATE`.** Would concentrate near-term-date search traffic (the
  overwhelming majority of real searches) onto a handful of hot partitions.
  See `design/SCHEMA_DESIGN.md` §2.
- **No offset-based pagination.** `LastEvaluatedKey`-based cursors only.

## Resume bullet

> Designed and built a distributed flight-search service on DynamoDB using
> single-table design with 2 GSIs to serve 3 access patterns (route+date
> search, price/class filtering, direct lookup) without table scans; seeded
> 100k+ synthetic records and load-tested to 150 concurrent users with a
> 99.8% success rate and p95 latency under 1.4s including cross-region
> network transit.
