# FlightSearch — DynamoDB Schema Design

## 1. Access patterns (written down before any code)

A user of a flight search product does one of these four things:

| # | Query in plain English | Frequency (assumed) |
|---|---|---|
| A | "Show me flights from SIN to JFK between Oct 1 and Oct 7" | Very high — this is the core search |
| B | "...and only economy class under $400" | High — almost every search adds a filter |
| C | "Show me the details of flight FL-00483821" | Medium — clicking into a result, deep link, booking confirmation |
| D | "Show me all Delta flights on this route" | Lower, but a real filter users apply |

Everything below is designed to answer these four with a DynamoDB `Query`, never a `Scan`.

## 2. Base table

```
Table: FlightSearch
PK: ROUTE#<origin>-<destination>          e.g. ROUTE#SIN-JFK
SK: DATE#<departureDate>#FLIGHT#<flightId> e.g. DATE#2026-10-03#FLIGHT#FL-00483821
```

Item attributes: `flightId, origin, destination, departureDate, departureTime,
arrivalTime, airline, seatClass, price, seatsAvailable, durationMinutes`.

**Query A** (route + date range) becomes:

```
Query:
  PK = ROUTE#SIN-JFK
  SK BETWEEN DATE#2026-10-01# AND DATE#2026-10-07#~
```

One partition, one query, sorted by date for free because DynamoDB sorts by SK.

### Why not `PK = DATE#<departureDate>` alone?

This is the naive design and it's tempting because "search by date" feels like
the obvious key. It fails for one reason: **real search traffic is not
uniform across dates.** The overwhelming majority of searches are for dates in
the next 1–14 days. If the partition key is the date, every one of those
searches — potentially the bulk of all traffic on the site — lands on a
handful of "hot" partitions (today, tomorrow, this weekend), while partitions
for dates six months out sit completely idle. DynamoDB scales by spreading
load across partitions; a key that concentrates real-world traffic onto a
handful of them defeats that.

Keying on `ROUTE` instead spreads load across every origin-destination pair
(thousands of them, even for a mid-size airline network), and it matches what
the user actually searches for — nobody searches "everything departing on
March 4th," they search "SIN to JFK."

## 3. GSI 1 — direct flight lookup

```
GSI1-PK: GSI1PK = FLIGHT#<flightId>
GSI1-SK: GSI1SK = FLIGHT#<flightId>
Projection: ALL
```

**Query C** becomes a single `Query` (effectively a keyed lookup) on GSI1.
This can't be served by the base table at all — `flightId` isn't a prefix of
the base PK, so finding a flight by ID without this index means scanning
every route partition, which is exactly the `Scan`-as-main-query-path
anti-pattern this project is meant to avoid.

## 4. GSI 2 — price/class filtering within a route

```
GSI2-PK: GSI2PK = ROUTE#<origin>-<destination>#CLASS#<seatClass>
GSI2-SK: GSI2SK = PRICE#<price, zero-padded to 6 digits>#DATE#<departureDate>
Projection: ALL
```

**Query B** becomes:

```
Query:
  GSI2PK = ROUTE#SIN-JFK#CLASS#ECONOMY
  GSI2SK < PRICE#000400#
```

Results come back already sorted by price, cheapest first.

### Why the base table can't serve this

The base table's SK is sorted by `DATE`, not `PRICE`. Filtering by price on
the base table means fetching the entire route partition (potentially
thousands of flights across all dates) and discarding everything over budget
in application code. That's a disguised scan-per-partition — it works at toy
data volumes and falls apart as the table grows, which is the whole point of
proving this design at 100k+ records rather than 100.

The zero-padding on price (`price.toString().padStart(6, '0')`) matters:
DynamoDB sort keys compare lexicographically as strings, so `"99" < "150"` is
true as a string comparison (`'9' > '1'`... actually false) — without
padding, string sort would put `"1000"` before `"99"`. Padding to a fixed
width makes lexicographic order match numeric order.

## 5. Access pattern D (filter by airline)

Not given its own GSI. It's served by adding a `FilterExpression` on top of
Query A's route+date result (airline is a low-cardinality attribute within an
already-narrow route/date partition, so filtering post-query is cheap and
doesn't justify a third index). This is called out explicitly in the API
layer rather than silently — a `FilterExpression` still reads every item in
the query result and discards non-matches, it just doesn't require a network
round trip per item the way a full scan would.

## 6. Capacity mode

On-demand capacity mode. No read/write capacity units to guess at for a side
project at this volume, and it stays within AWS free tier at 100k items /
moderate load-test traffic.
