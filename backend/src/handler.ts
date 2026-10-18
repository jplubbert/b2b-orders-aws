import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { dynamoCatalogRepo } from './data/catalogRepo.js';
import { dynamoOrderRepo } from './data/orderRepo.js';
import { route, type Deps, type ResolverEvent } from './router.js';

const tableName = process.env.TABLE_NAME;
if (!tableName) throw new Error('TABLE_NAME no definido');

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const deps: Deps = { catalog: dynamoCatalogRepo(doc, tableName), orders: dynamoOrderRepo(doc, tableName) };

/** Lambda `api`: fuente de datos directa de AppSync para todos los campos (DEC-005). */
export const handler = (event: ResolverEvent) => route(deps, event);
