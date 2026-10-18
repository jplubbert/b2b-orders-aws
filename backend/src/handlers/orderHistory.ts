import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { dynamoHistoryRepo } from '../data/historyRepo.js';
import { recordOrderEvents } from '../history.js';

const tableName = process.env.TABLE_NAME;
if (!tableName) throw new Error('TABLE_NAME is not set');
const history = dynamoHistoryRepo(DynamoDBDocumentClient.from(new DynamoDBClient({})), tableName);

/** `order-history` Lambda (DEC-020): SQS source in batches, consumer of the `order-events` topic. */
export const handler = (event: SQSEvent): Promise<SQSBatchResponse> => recordOrderEvents(history, event);
