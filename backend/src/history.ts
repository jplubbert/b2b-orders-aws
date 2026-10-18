import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import type { HistoryRepo } from './data/historyRepo.js';
import { parseOrderEvent } from './domain/orderEvent.js';

/**
 * DEC-020: stores each SQS message as a history event. A duplicate delivery is a success that writes nothing
 * (REQ-012 E5); a failing message is reported alone (`ReportBatchItemFailures`), so it's retried and, after
 * `maxReceiveCount`, set aside in the DLQ without holding back the rest of the batch (E6).
 */
export async function recordOrderEvents(history: Pick<HistoryRepo, 'putEvent'>, event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];
  for (const record of event.Records) {
    try {
      const stored = await history.putEvent(parseOrderEvent(record.body));
      if (!stored) console.log(JSON.stringify({ msg: 'Duplicate order event ignored', messageId: record.messageId }));
    } catch (err) {
      console.error(JSON.stringify({ msg: 'Order event not recorded', messageId: record.messageId, error: String(err) }));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
