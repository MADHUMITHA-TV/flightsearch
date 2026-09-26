/**
 * create-table.js
 *
 * Creates the FlightSearch table with both GSIs, on-demand (PAY_PER_REQUEST)
 * billing mode as specified — no RCU/WCU guessing for a side project.
 *
 * Usage:
 *   node create-table.js
 */

const { DynamoDBClient, CreateTableCommand, waitUntilTableExists } = require('@aws-sdk/client-dynamodb');

const TABLE_NAME = process.env.TABLE_NAME || 'FlightSearch';
const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

async function main() {
  const command = new CreateTableCommand({
    TableName: TABLE_NAME,
    BillingMode: 'PAY_PER_REQUEST', // on-demand capacity, per the project brief
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
      { AttributeName: 'GSI2PK', AttributeType: 'S' },
      { AttributeName: 'GSI2SK', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI1-FlightById',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'GSI2-PriceByRouteClass',
        KeySchema: [
          { AttributeName: 'GSI2PK', KeyType: 'HASH' },
          { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  });

  console.log(`Creating table ${TABLE_NAME}...`);
  await client.send(command);

  console.log('Waiting for table to become ACTIVE...');
  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName: TABLE_NAME });

  console.log(`Table ${TABLE_NAME} is ready.`);
}

main().catch((err) => {
  console.error('Table creation failed:', err);
  process.exit(1);
});
