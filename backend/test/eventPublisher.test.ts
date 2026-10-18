import type { SNSClient } from '@aws-sdk/client-sns';
import { describe, expect, it } from 'vitest';
import { snsOrderEventPublisher } from '../src/data/eventPublisher.js';
import { orderCreatedEvent, orderStatusChangedEvent, parseOrderEvent } from '../src/domain/orderEvent.js';
import type { Order } from '../src/domain/order.js';

const order: Order = {
  id: '01JAAAAAAAAAAAAAAAAAB7XQ2M9Z',
  customerId: 'C-1',
  number: 'B7XQ2M9Z',
  createdAt: '2026-10-17T23:00:00.000Z',
  total: 4500,
  status: 'RECIBIDO',
  lines: [{ productId: 'yerba', name: 'Yerba 1 kg', presentation: 'Paquete', quantity: 1, unitPrice: 4500, subtotal: 4500 }],
};

describe('order events (DEC-020)', () => {
  it('OrderCreated: RECIBIDO with no previous status, at the order time, with a ULID from that time', () => {
    const e = orderCreatedEvent(order);
    expect(e).toMatchObject({ type: 'OrderCreated', orderId: order.id, customerId: 'C-1', from: null, to: 'RECIBIDO' });
    expect(e.at).toBe(order.createdAt);
    expect(e.eventId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(orderCreatedEvent(order).eventId).not.toBe(e.eventId);
  });

  it('OrderStatusChanged: from → to at the moment the publisher fixes (S-33)', () => {
    const now = Date.parse('2026-10-18T12:00:00.000Z');
    const e = orderStatusChangedEvent({ ...order, status: 'ENVIADO' }, 'RECIBIDO', now);
    expect(e).toMatchObject({ type: 'OrderStatusChanged', from: 'RECIBIDO', to: 'ENVIADO', at: '2026-10-18T12:00:00.000Z' });
  });

  it('what is published is what the history Lambda parses back', () => {
    const e = orderStatusChangedEvent({ ...order, status: 'ENVIADO' }, 'ENVIADO', Date.now());
    expect(parseOrderEvent(JSON.stringify(e))).toEqual(e);
    expect(parseOrderEvent(JSON.stringify(orderCreatedEvent(order)))).toMatchObject({ from: null });
  });

  it('the SNS publisher sends the JSON message to the topic with its type as an attribute', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const sns = { send: async (cmd: { input: Record<string, unknown> }) => void sent.push(cmd.input) } as unknown as SNSClient;
    const e = orderCreatedEvent(order);
    await snsOrderEventPublisher(sns, 'arn:aws:sns:us-east-1:1:order-events').publish(e);
    expect(sent).toEqual([
      {
        TopicArn: 'arn:aws:sns:us-east-1:1:order-events',
        Message: JSON.stringify(e),
        MessageAttributes: { type: { DataType: 'String', StringValue: 'OrderCreated' } },
      },
    ]);
  });
});
