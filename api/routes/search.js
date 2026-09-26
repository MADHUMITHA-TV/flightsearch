const express = require('express');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc, TABLE_NAME } = require('../lib/dynamo');
const { encodeCursor, decodeCursor } = require('../lib/cursor');

const router = express.Router();

/**
 * GET /search
 *   ?origin=SIN&destination=JFK
 *   &startDate=2026-10-01&endDate=2026-10-07     (required)
 *   &airline=Delta                                (optional, post-query filter)
 *   &limit=20                                     (optional, default 20, max 100)
 *   &cursor=<opaque>                              (optional, from a previous response)
 *
 * Serves access pattern A (route + date range) directly against the base
 * table's PK/SK. Access pattern D (airline filter) is layered on as a
 * DynamoDB FilterExpression -- it still reads every item in the route/date
 * partition slice and discards non-matches server-side, which is fine
 * because that slice is already narrow (one route, up to a week of dates),
 * not the whole table. It does NOT reduce read capacity consumed, only
 * what's returned to the client -- called out here deliberately per the
 * schema design doc.
 */
router.get('/search', async (req, res, next) => {
  try {
    const { origin, destination, startDate, endDate, airline } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    if (!origin || !destination || !startDate || !endDate) {
      return res.status(400).json({
        error: 'origin, destination, startDate, and endDate are all required',
      });
    }

    const params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :skStart AND :skEnd',
      ExpressionAttributeValues: {
        ':pk': `ROUTE#${origin.toUpperCase()}-${destination.toUpperCase()}`,
        ':skStart': `DATE#${startDate}#`,
        ':skEnd': `DATE#${endDate}#\uffff`, // \uffff sorts after any FLIGHT# suffix for that date
      },
      Limit: limit,
      ExclusiveStartKey: decodeCursor(req.query.cursor),
    };

    if (airline) {
      params.FilterExpression = 'airline = :airline';
      params.ExpressionAttributeValues[':airline'] = airline;
    }

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
