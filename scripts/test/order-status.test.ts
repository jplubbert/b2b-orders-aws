import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import { SetStatusError, setOrderStatus } from '../lib/order-status.ts';

// Cliente falso: devuelve las respuestas en orden (o las lanza si son Error) y guarda cada comando.
function fakeDoc(responses: unknown[]) {
  const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
  const doc = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      const r = responses[sent.length - 1] ?? {};
      if (r instanceof Error) throw r;
      return r;
    },
  } as unknown as DynamoDBDocumentClient;
  return { doc, sent };
}

const ID = '01JAAAAAAAAAAAAAAAAAB7XQ2M9Z';
const key = { PK: 'CUSTOMER#C-1', SK: `ORDER#${ID}` };

describe('order:set-status (DEC-009, REQ-004 E2)', () => {
  it('busca el pedido por id en todas las particiones de clientes (recorre páginas) y cambia solo el estado', async () => {
    const { doc, sent } = fakeDoc([{ Items: [], LastEvaluatedKey: { PK: 'x', SK: 'y' } }, { Items: [key] }, {}]);
    await expect(setOrderStatus(doc, 'tabla', ID, 'ENVIADO')).resolves.toBe('ENVIADO');
    expect(sent.map((s) => s.name)).toEqual(['ScanCommand', 'ScanCommand', 'UpdateCommand']);
    expect(sent[0]!.input).toMatchObject({
      TableName: 'tabla',
      FilterExpression: 'SK = :sk AND begins_with(PK, :pk)',
      ExpressionAttributeValues: { ':sk': `ORDER#${ID}`, ':pk': 'CUSTOMER#' },
    });
    expect(sent[1]!.input.ExclusiveStartKey).toEqual({ PK: 'x', SK: 'y' });
    expect(sent[2]!.input).toEqual({
      TableName: 'tabla',
      Key: key,
      UpdateExpression: 'SET #status = :status',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'ENVIADO' },
    });
  });

  it.each(['PERDIDO', 'enviado', ''])('rechaza el estado %j sin tocar la tabla', async (status) => {
    const { doc, sent } = fakeDoc([]);
    await expect(setOrderStatus(doc, 'tabla', ID, status)).rejects.toBeInstanceOf(SetStatusError);
    expect(sent).toEqual([]);
  });

  it('pedido inexistente → error, sin escribir', async () => {
    const { doc, sent } = fakeDoc([{ Items: [] }]);
    await expect(setOrderStatus(doc, 'tabla', 'NOPE', 'ENVIADO')).rejects.toThrow('No existe el pedido NOPE');
    expect(sent.map((s) => s.name)).toEqual(['ScanCommand']);
  });

  it('si el pedido desaparece entre la búsqueda y la escritura → error de pedido inexistente', async () => {
    const gone = new ConditionalCheckFailedException({ message: 'gone', $metadata: {} });
    const { doc } = fakeDoc([{ Items: [key] }, gone]);
    await expect(setOrderStatus(doc, 'tabla', ID, 'ENTREGADO')).rejects.toBeInstanceOf(SetStatusError);
  });
});
