import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SNSClient } from '@aws-sdk/client-sns';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { dynamoCatalogRepo } from './data/catalogRepo.js';
import { snsOrderEventPublisher, type OrderEventPublisher } from './data/eventPublisher.js';
import { dynamoHistoryRepo } from './data/historyRepo.js';
import { dynamoOrderRepo } from './data/orderRepo.js';
import { PUBLISHING_DOMAINS, type Domain } from './domains.js';
import { domainResolvers, route, type Deps, type ResolverEvent } from './router.js';

// A domain that doesn't publish never calls this; if it did, `route` logs the error (S-32).
const noPublisher: OrderEventPublisher = {
  publish: async () => {
    throw new Error('This domain does not publish order events');
  },
};

/** Handler of one domain Lambda (DEC-019): direct AppSync data source for that domain's fields only. */
export function domainHandler(domain: Domain): (event: ResolverEvent) => Promise<unknown> {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) throw new Error('TABLE_NAME is not set');
  const topicArn = process.env.TOPIC_ARN;
  if (PUBLISHING_DOMAINS.includes(domain) && !topicArn) throw new Error('TOPIC_ARN is not set');
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  // Building a repo calls nothing: each function's IAM role limits what it can actually do.
  const deps: Deps = {
    catalog: dynamoCatalogRepo(doc, tableName),
    orders: dynamoOrderRepo(doc, tableName),
    history: dynamoHistoryRepo(doc, tableName),
    events: topicArn ? snsOrderEventPublisher(new SNSClient({}), topicArn) : noPublisher,
  };
  const available = domainResolvers(domain);
  return (event) => route(deps, event, available);
}
