import type { OrderStatusEvent } from '../generated/graphql.js';
import { isOrderStatus, type Order, type OrderStatus } from './order.js';
import { ulid } from './ulid.js';

export type { OrderStatusEvent };

/** DEC-020: `OrderCreated` (no `from`) when an order is confirmed, `OrderStatusChanged` when its status changes. */
export type OrderEventType = 'OrderCreated' | 'OrderStatusChanged';

/** Message published to the `order-events` topic and read by the history Lambda (raw delivery: the SQS body). */
export interface OrderEventMessage extends OrderStatusEvent {
  type: OrderEventType;
}

/** `RECIBIDO` event of a new order; `at` is the order's own `createdAt` (S-33). */
export function orderCreatedEvent(order: Order, newId: (now: number) => string = ulid): OrderEventMessage {
  return {
    type: 'OrderCreated',
    eventId: newId(Date.parse(order.createdAt)),
    orderId: order.id,
    customerId: order.customerId,
    from: null,
    to: order.status,
    at: order.createdAt,
  };
}

/** `from → to` event of an accepted status change, also when both are equal (REQ-012 E3). */
export function orderStatusChangedEvent(
  order: Order,
  from: OrderStatus,
  now: number,
  newId: (now: number) => string = ulid,
): OrderEventMessage {
  return {
    type: 'OrderStatusChanged',
    eventId: newId(now),
    orderId: order.id,
    customerId: order.customerId,
    from,
    to: order.status,
    at: new Date(now).toISOString(),
  };
}

/** Validates an SQS body; throws on anything malformed so the message is retried and ends in the DLQ (REQ-012 E6). */
export function parseOrderEvent(body: string): OrderEventMessage {
  const raw: unknown = JSON.parse(body);
  if (typeof raw !== 'object' || raw === null) throw new Error('Order event is not an object');
  const m = raw as Record<string, unknown>;
  const text = (key: string) => {
    const v = m[key];
    if (typeof v !== 'string' || v === '') throw new Error(`Order event without ${key}`);
    return v;
  };
  const type = text('type');
  if (type !== 'OrderCreated' && type !== 'OrderStatusChanged') throw new Error(`Unknown order event type: ${type}`);
  const to = text('to');
  if (!isOrderStatus(to)) throw new Error(`Invalid order event status: ${to}`);
  let from: OrderStatus | null = null;
  if (type === 'OrderStatusChanged') {
    const f = text('from');
    if (!isOrderStatus(f)) throw new Error(`Invalid order event status: ${f}`);
    from = f;
  }
  const at = text('at');
  if (Number.isNaN(Date.parse(at))) throw new Error(`Invalid order event time: ${at}`);
  return { type, eventId: text('eventId'), orderId: text('orderId'), customerId: text('customerId'), from, to, at };
}
