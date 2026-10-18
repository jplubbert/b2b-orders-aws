import type { SQSEvent } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryRepo } from '../src/data/historyRepo.js';
import type { OrderEventMessage, OrderStatusEvent } from '../src/domain/orderEvent.js';
import { recordOrderEvents } from '../src/history.js';

// In-memory history with the repository's idempotency: one row per (orderId, at, eventId).
function memoryHistory(fail?: (e: OrderStatusEvent) => boolean) {
  const rows = new Map<string, OrderStatusEvent>();
  const repo: Pick<HistoryRepo, 'putEvent'> = {
    async putEvent(e) {
      if (fail?.(e)) throw new Error('write failed');
      const key = `${e.orderId}|${e.at}|${e.eventId}`;
      if (rows.has(key)) return false;
      rows.set(key, e);
      return true;
    },
  };
  return { repo, rows };
}

const message = (eventId: string, extra: Partial<OrderEventMessage> = {}): OrderEventMessage => ({
  type: 'OrderCreated',
  eventId,
  orderId: 'O-1',
  customerId: 'C-1',
  from: null,
  to: 'RECIBIDO',
  at: '2026-10-18T12:00:00.000Z',
  ...extra,
});

const sqs = (...bodies: Array<[messageId: string, body: string]>): SQSEvent =>
  ({ Records: bodies.map(([messageId, body]) => ({ messageId, body })) }) as unknown as SQSEvent;

describe('recordOrderEvents: history Lambda (REQ-012, DEC-020)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stores each message of the batch as one event', async () => {
    const { repo, rows } = memoryHistory();
    const changed = message('E2', { type: 'OrderStatusChanged', from: 'RECIBIDO', to: 'ENVIADO', at: '2026-10-18T12:01:00.000Z' });
    const out = await recordOrderEvents(repo, sqs(['m1', JSON.stringify(message('E1'))], ['m2', JSON.stringify(changed)]));
    expect(out).toEqual({ batchItemFailures: [] });
    expect([...rows.values()].map((e) => [e.eventId, e.from, e.to])).toEqual([
      ['E1', null, 'RECIBIDO'],
      ['E2', 'RECIBIDO', 'ENVIADO'],
    ]);
  });

  it('E5: the same message delivered twice (same batch or another one) is stored once, without failing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { repo, rows } = memoryHistory();
    const body = JSON.stringify(message('E1'));
    expect(await recordOrderEvents(repo, sqs(['m1', body], ['m1-again', body]))).toEqual({ batchItemFailures: [] });
    expect(await recordOrderEvents(repo, sqs(['m1-later', body]))).toEqual({ batchItemFailures: [] });
    expect(rows.size).toBe(1);
  });

  it('E6: a failing message is reported alone; the rest of the batch is still stored', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { repo, rows } = memoryHistory((e) => e.eventId === 'BAD');
    const out = await recordOrderEvents(
      repo,
      sqs(['m1', JSON.stringify(message('E1'))], ['m2', JSON.stringify(message('BAD'))], ['m3', JSON.stringify(message('E3'))]),
    );
    expect(out).toEqual({ batchItemFailures: [{ itemIdentifier: 'm2' }] });
    expect([...rows.values()].map((e) => e.eventId)).toEqual(['E1', 'E3']);
    expect(String(errors.mock.calls[0]![0])).toContain('m2');
  });

  it.each([
    ['not JSON', 'nope'],
    ['not an object', '42'],
    ['unknown type', JSON.stringify(message('E1', { type: 'OrderDeleted' as never }))],
    ['invalid status', JSON.stringify(message('E1', { to: 'PERDIDO' as never }))],
    ['status change without from', JSON.stringify(message('E1', { type: 'OrderStatusChanged' }))],
    ['invalid time', JSON.stringify(message('E1', { at: 'yesterday' }))],
    ['no orderId', JSON.stringify(message('E1', { orderId: '' }))],
  ])('E6: a malformed message (%s) fails, so it ends in the DLQ, and writes nothing', async (_case, body) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { repo, rows } = memoryHistory();
    expect(await recordOrderEvents(repo, sqs(['m1', body]))).toEqual({ batchItemFailures: [{ itemIdentifier: 'm1' }] });
    expect(rows.size).toBe(0);
  });

  it('OrderCreated ignores a stray from: the creation event has no previous status', async () => {
    const { repo, rows } = memoryHistory();
    await recordOrderEvents(repo, sqs(['m1', JSON.stringify(message('E1', { from: 'ENVIADO' }))]));
    expect([...rows.values()][0]!.from).toBeNull();
  });
});
