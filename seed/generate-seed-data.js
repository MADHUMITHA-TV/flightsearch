/**
 * generate-seed-data.js
 *
 * Generates synthetic flight records and writes them to a newline-delimited
 * JSON file (one flight per line) so the loader can stream it without
 * holding 100k+ objects in memory at once.
 *
 * Usage:
 *   node generate-seed-data.js [count]
 *   node generate-seed-data.js 150000
 *
 * Default count: 100000
 */

const fs = require('fs');
const path = require('path');

const COUNT = parseInt(process.argv[2], 10) || 100000;
const OUTPUT_PATH = path.join(__dirname, 'flights.ndjson');

// A realistic-ish set of airports so route cardinality is meaningful
// (this drives partition spread — see SCHEMA_DESIGN.md).
const AIRPORTS = [
  'JFK', 'LAX', 'ORD', 'ATL', 'DFW', 'SFO', 'SEA', 'MIA', 'BOS', 'DEN',
  'LHR', 'CDG', 'FRA', 'AMS', 'MAD', 'FCO', 'IST', 'DXB', 'DOH', 'SIN',
  'HND', 'ICN', 'HKG', 'BKK', 'SYD', 'MEL', 'GRU', 'MEX', 'YYZ', 'DEL',
];

const AIRLINES = [
  'Delta', 'United', 'American', 'Emirates', 'Qatar Airways', 'Singapore Airlines',
  'Lufthansa', 'Air France', 'British Airways', 'ANA', 'Cathay Pacific', 'Qantas',
];

const SEAT_CLASSES = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
const SEAT_CLASS_PRICE_MULTIPLIER = { ECONOMY: 1, PREMIUM_ECONOMY: 1.8, BUSINESS: 3.2, FIRST: 5.5 };

const START_DATE = new Date('2026-10-01T00:00:00Z');
const DATE_RANGE_DAYS = 180; // 6 months of departures

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomRoute() {
  const origin = pick(AIRPORTS);
  let destination = pick(AIRPORTS);
  while (destination === origin) destination = pick(AIRPORTS);
  return { origin, destination };
}

function randomDate() {
  const offset = Math.floor(Math.random() * DATE_RANGE_DAYS);
  const d = new Date(START_DATE.getTime() + offset * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function randomTime() {
  const h = Math.floor(Math.random() * 24).toString().padStart(2, '0');
  const m = pick(['00', '15', '30', '45']);
  return `${h}:${m}`;
}

function basePrice(origin, destination) {
  // Rough distance proxy: hash the route string into a stable-ish base fare.
  const seed = (origin + destination).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return 80 + (seed % 40) * 15; // ~$80-$680 base range
}

function generateFlight(index) {
  const { origin, destination } = randomRoute();
  const departureDate = randomDate();
  const seatClass = pick(SEAT_CLASSES);
  const price = Math.round(basePrice(origin, destination) * SEAT_CLASS_PRICE_MULTIPLIER[seatClass] * (0.85 + Math.random() * 0.3));
  const flightId = `FL-${(1000000 + index).toString()}`;

  return {
    flightId,
    origin,
    destination,
    departureDate,
    departureTime: randomTime(),
    durationMinutes: 60 + Math.floor(Math.random() * 900),
    airline: pick(AIRLINES),
    seatClass,
    price,
    seatsAvailable: Math.floor(Math.random() * 180),
  };
}

function main() {
  const out = fs.createWriteStream(OUTPUT_PATH, { flags: 'w' });
  console.log(`Generating ${COUNT} synthetic flight records -> ${OUTPUT_PATH}`);

  for (let i = 0; i < COUNT; i++) {
    out.write(JSON.stringify(generateFlight(i)) + '\n');
    if (i > 0 && i % 20000 === 0) {
      console.log(`  ${i} / ${COUNT}`);
    }
  }

  out.end(() => {
    console.log(`Done. Wrote ${COUNT} records.`);
  });
}

main();
