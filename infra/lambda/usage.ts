import { usageLogLine, usageRecord } from '../../src/usage.ts';

interface FunctionUrlEvent {
  queryStringParameters?: Record<string, string | undefined>;
}

/** Counts one usage event (see src/usage.ts). Logs nothing about the request itself: no IP, no user agent. */
export async function handler(event: FunctionUrlEvent) {
  const record = usageRecord(event.queryStringParameters ?? {});
  // Raw stdout, so the line reaches CloudWatch as-is and is read as an embedded metric.
  if (record) process.stdout.write(`${usageLogLine(record, Date.now())}\n`);
  return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
}
