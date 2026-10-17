import { DynamoDBDocumentClient, QueryCommand, type QueryCommandOutput } from '@aws-sdk/lib-dynamodb';
import type { Product } from '../domain/catalog.js';
import { CATALOG_PK, PRODUCT_SK_PREFIX } from './keys.js';

export interface CatalogRepo {
  listProducts(): Promise<Product[]>;
}

export function dynamoCatalogRepo(doc: DynamoDBDocumentClient, tableName: string): CatalogRepo {
  return {
    async listProducts() {
      const products: Product[] = [];
      let startKey: QueryCommandOutput['LastEvaluatedKey'];
      do {
        const page = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: { ':pk': CATALOG_PK, ':sk': PRODUCT_SK_PREFIX },
            ExclusiveStartKey: startKey,
          }),
        );
        for (const item of page.Items ?? []) products.push(toProduct(item));
        startKey = page.LastEvaluatedKey;
      } while (startKey);
      return products;
    },
  };
}

function toProduct(item: Record<string, unknown>): Product {
  return {
    productId: String(item.productId),
    name: String(item.name),
    presentation: String(item.presentation),
    unitPrice: Number(item.unitPrice),
    active: item.active === true,
  };
}
