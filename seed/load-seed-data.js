/**
 * load-seed-data.js
 *
 * Streams flights.ndjson (produced by generate-seed-data.js) and batch-writes
 * it into the FlightSearch DynamoDB table using BatchWriteItem (25 items per
 * batch, which is the DynamoDB hard limit), with retry-on-throttle for any
 * UnprocessedItems.
 *
 * Requires AWS credentials in the environment (AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY / AWS_REGION), same as any AWS SDK v3 script.
 *
 * Usage:
 *   node load-seed-data.js
 *   TABLE_NAME=FlightSearch node load-seed-data.js
 */

const fs = require('fs');
const readline = require('readline');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.TABLE_NAME || 'FlightSearch';
const INPUT_PATH = process.env.INPUT_PATH || require('path').join(__dirname, 'flights.ndjson');
const BATCH_SIZE = 25; // DynamoDB BatchWriteItem hard limit

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const doc = DynamoDBDocumentClient.from(client);

function padPrice(price) {
  return String(price).padStart(6, '0');
}

function toItem(flight) {
  const { flightId, origin, destination, departureDate, seatClass, price } = flight;
  return {
    PK: `ROUTE#${origin}-${destination}`,
    SK: `DATE#${departureDate}#FLIGHT#${flightId}`,
    GSI1PK: `FLIGHT#${flightId}`,
    GSI1SK: `FLIGHT#${flightId}`,
    GSI2PK: `ROUTE#${origin}-${destination}#CLASS#${seatClass}`,
    GSI2SK: `PRICE#${padPrice(price)}#DATE#${departureDate}`,
    ...flight,
  };
}

async function writeBatchWithRetry(items) {
  let requestItems = {
    [TABLE_NAME]: items.map((Item) => ({ PutRequest: { Item } })),
  };

  let attempt = 0;
  while (Object.keys(requestItems).length > 0) {
    const result = await doc.send(new BatchWriteCommand({ RequestItems: requestItems }));
    requestItems = result.UnprocessedItems || {};
    if (Object.keys(requestItems).length > 0) {
      attempt++;
      const backoffMs = Math.min(1000 * 2 ** attempt, 10000);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

async function main() {
  const rl = readline.createInterface({ input: fs.createReadStream(INPUT_PATH), crlfDelay: Infinity });

  let batch = [];
  let total = 0;
  const started = Date.now();

  for await (const line of rl) {
    if (!line.trim()) continue;
    const flight = JSON.parse(line);
    batch.push(toItem(flight));

    if (batch.length === BATCH_SIZE) {
      await writeBatchWithRetry(batch);
      total += batch.length;
      batch = [];
      if (total % 5000 === 0) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`  loaded ${total} items (${elapsed}s elapsed)`);
      }
    }
  }

  if (batch.length > 0) {
    await writeBatchWithRetry(batch);
    total += batch.length;
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Done. Loaded ${total} items into ${TABLE_NAME} in ${elapsed}s.`);
}

main().catch((err) => {
  console.error('Load failed:', err);
  process.exit(1);
});
