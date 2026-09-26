const https = require('https');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  requestHandler: new NodeHttpHandler({
    httpsAgent: new https.Agent({
      keepAlive: true,
      maxSockets: 500,
    }),
  }),
});
const doc = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const TABLE_NAME = process.env.TABLE_NAME || 'FlightSearch';

module.exports = { doc, TABLE_NAME };
