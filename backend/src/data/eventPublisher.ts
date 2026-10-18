import { PublishCommand, type SNSClient } from '@aws-sdk/client-sns';
import type { OrderEventMessage } from '../domain/orderEvent.js';

export interface OrderEventPublisher {
  publish(event: OrderEventMessage): Promise<void>;
}

/** DEC-020: standard `order-events` topic; the queue subscribes with raw delivery, so the body is this JSON. */
export function snsOrderEventPublisher(sns: Pick<SNSClient, 'send'>, topicArn: string): OrderEventPublisher {
  return {
    async publish(event) {
      await sns.send(
        new PublishCommand({
          TopicArn: topicArn,
          Message: JSON.stringify(event),
          MessageAttributes: { type: { DataType: 'String', StringValue: event.type } },
        }),
      );
    },
  };
}
