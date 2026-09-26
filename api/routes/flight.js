const express = require('express');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { doc, TABLE_NAME } = require('../lib/dynamo');

const router = express.Router();

/**
 * GET /flight/:flightId
 *
 * Serves access pattern C: direct lookup by flight ID via GSI1
 * (GSI1PK = GSI1SK = FLIGHT#<id>). This is the pattern the base table
 * cannot answer without a full scan, since flightId isn't a prefix of PK.
 */
router.get('/flight/:flightId', async (req, res, next) => {
  try {
    const { flightId } = req.params;

    const result = await doc.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1-FlightById',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `FLIGHT#${flightId}` },
      Limit: 1,
    }));

    if (result.Items.length === 0) {
      return res.status(404).json({ error: `Flight ${flightId} not found` });
    }

    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...flight } = result.Items[0];
    res.json(flight);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
