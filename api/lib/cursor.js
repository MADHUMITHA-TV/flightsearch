/**
 * DynamoDB pagination is cursor-based by nature: a Query returns
 * LastEvaluatedKey when there are more results, and you pass that back as
 * ExclusiveStartKey to get the next page. There is no "page number" concept
 * (that's an offset-based idea from SQL LIMIT/OFFSET, which doesn't map onto
 * a partitioned key-value store without a full re-scan per page).
 *
 * We base64-encode LastEvaluatedKey into an opaque `nextCursor` string for
 * the client, rather than exposing raw DynamoDB key attributes over the API.
 */

function encodeCursor(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch (err) {
    const e = new Error('Invalid pagination cursor');
    e.status = 400;
    throw e;
  }
}

module.exports = { encodeCursor, decodeCursor };
