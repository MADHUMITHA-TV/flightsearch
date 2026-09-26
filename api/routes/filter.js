const express = require('express');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc, TABLE_NAME } = require('../lib/dynamo');
const { encodeCursor, decodeCursor } = require('../lib/cursor');

const router = express.Router();

function padPrice(price) {
  return String(price).padStart(6, '0');
}

/**
 * GET /filter
 *   ?origin=SIN&destination=JFK&seatClass=ECONOMY
 *   &maxPrice=400                    (required)
 *   &minPrice=0                      (optional, default 0)
 *   &limit=20&cursor=<opaque>
 *
 * Serves access pattern B: price range + seat class within a route, via
 * GSI2 (GSI2PK = ROUTE#..#CLASS#.., GSI2SK = PRICE#<padded>#DATE#..).
 * Results come back sorted cheapest-first because DynamoDB sorts by GSI
 * sort key, and price is the leading component of GSI2SK.
 */
router.get('/filter', async (req, res, next) => {
  try {
    const { origin, destination, seatClass } = req.query;
    const maxPrice = parseInt(req.query.maxPrice, 10);
    const minPrice = parseInt(req.query.minPrice, 10) || 0;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    if (!origin || !destination || !seatClass || Number.isNaN(maxPrice)) {
      return res.status(400).json({
        error: 'origin, destination, seatClass, and maxPrice are required',
      });
    }

    const params = {
      TableName: TABLE_NAME,
      IndexName: 'GSI2-PriceByRouteClass',
      KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK BETWEEN :skStart AND :skEnd',
      ExpressionAttributeValues: {
        ':pk': `ROUTE#${origin.toUpperCase()}-${destination.toUpperCase()}#CLASS#${seatClass.toUpperCase()}`,
        ':skStart': `PRICE#${padPrice(minPrice)}#`,
        ':skEnd': `PRICE#${padPrice(maxPrice)}#\uffff`,
      },
      Limit: limit,
      ExclusiveStartKey: decodeCursor(req.query.cursor),
    };

    const result = await doc.send(new QueryCommand(params));

    res.json({
      count: result.Items.length,
      flights: result.Items.map(stripInternalKeys),
      nextCursor: encodeCursor(result.LastEvaluatedKey),
    });
  } catch (err) {
    next(err);
  }
});

function stripInternalKeys(item) {
  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...rest } = item;
  return rest;
}

module.exports = router;
