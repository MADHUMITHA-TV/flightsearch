/**
 * k6-script.js
 *
 * Load test for the FlightSearch API. Ramps virtual users 50 -> 200 -> 500
 * hitting a mix of the three endpoints, and reports p95 latency per endpoint
 * via custom Trend metrics.
 *
 * Since DynamoDB is fully managed, this test validates the API layer and
 * query design (Express overhead, JSON marshalling, GSI query shape) rather
 * than infrastructure capacity -- that's the point: p95 numbers here reflect
 * whether the PK/SK/GSI design keeps queries cheap at scale, not whether a
 * server fell over.
 *
 * Usage:
 *   k6 run load-test/k6-script.js
 *   BASE_URL=http://localhost:3000 k6 run load-test/k6-script.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const searchLatency = new Trend('search_latency', true);
const filterLatency = new Trend('filter_latency', true);
const flightLatency = new Trend('flight_latency', true);

// Real routes/dates must match what generate-seed-data.js actually produced.
const ROUTES = [
  ['JFK', 'LAX'], ['LHR', 'CDG'], ['SIN', 'HND'], ['DXB', 'DOH'],
  ['SYD', 'MEL'], ['ATL', 'ORD'], ['GRU', 'MEX'], ['ICN', 'HKG'],
];
const SEAT_CLASSES = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
  { duration: '1m', target: 50 },
  { duration: '2m', target: 50 },
  { duration: '1m', target: 200 },
  { duration: '2m', target: 200 },
  { duration: '1m', target: 500 },
  { duration: '2m', target: 500 },
  { duration: '1m', target: 0 },
],
    },
  },
  thresholds: {
    // These are goals to check against, not numbers to report as-is --
    // the README pulls the real measured p95 out of the k6 summary output.
    search_latency: ['p(95)<300'],
    filter_latency: ['p(95)<300'],
    flight_latency: ['p(95)<100'],
  },
};

function randomRoute() {
  return ROUTES[Math.floor(Math.random() * ROUTES.length)];
}

function randomDateRange() {
  const startOffset = Math.floor(Math.random() * 170);
  const start = new Date('2026-10-01T00:00:00Z');
  start.setUTCDate(start.getUTCDate() + startOffset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

export default function () {
  const [origin, destination] = randomRoute();

  // 1. Route + date range search (base table Query)
  const [startDate, endDate] = randomDateRange();
  const searchUrl = `${BASE_URL}/search?origin=${origin}&destination=${destination}&startDate=${startDate}&endDate=${endDate}`;
  const searchRes = http.get(searchUrl, { tags: { name: 'search' } });
  searchLatency.add(searchRes.timings.duration);
  check(searchRes, { 'search status 200': (r) => r.status === 200 });

  // 2. Price/class filter (GSI2 Query)
  const seatClass = SEAT_CLASSES[Math.floor(Math.random() * SEAT_CLASSES.length)];
  const filterUrl = `${BASE_URL}/filter?origin=${origin}&destination=${destination}&seatClass=${seatClass}&maxPrice=500`;
  const filterRes = http.get(filterUrl, { tags: { name: 'filter' } });
  filterLatency.add(filterRes.timings.duration);
  check(filterRes, { 'filter status 200': (r) => r.status === 200 });

  // 3. Direct flight lookup (GSI1 Query) -- pull a flightId from the search
  // response if we got one, so this exercises a real ID, not a guess.
  if (searchRes.status === 200) {
    const body = JSON.parse(searchRes.body);
    if (body.flights && body.flights.length > 0) {
      const flightId = body.flights[0].flightId;
      const flightRes = http.get(`${BASE_URL}/flight/${flightId}`, { tags: { name: 'flight' } });
      flightLatency.add(flightRes.timings.duration);
      check(flightRes, { 'flight status 200': (r) => r.status === 200 });
    }
  }

  sleep(1);
}
