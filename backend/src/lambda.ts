import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { dynamoCatalogRepo } from './data/catalogRepo.js';
import { dynamoOrderRepo } from './data/orderRepo.js';
import type { Domain } from './domains.js';
import { domainResolvers, route, type Deps, type ResolverEvent } from './router.js';

/** Handler of one domain Lambda (DEC-019): direct AppSync data source for that domain's fields only. */
export function domainHandler(domain: Domain): (event: ResolverEvent) => Promise<unknown> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) throw new Error('TABLE_NAME is not set');
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  // Building a repo calls nothing: each function's IAM role limits what it can actually do.
  const deps: Deps = { catalog: dynamoCatalogRepo(doc, tableName), orders: dynamoOrderRepo(doc, tableName) };
  const available = domainResolvers(domain);
  return (event) => route(deps, event, available);
}
