import { violationLogLine, violationRecord } from '../../src/own-violations.ts';

interface FunctionUrlEvent {
  queryStringParameters?: Record<string, string | undefined>;
}

/** Counts one violation of our own policy (see src/own-violations.ts). Logs nothing about the request: no IP, no user agent. */
export async function handler(event: FunctionUrlEvent) {
  const record = violationRecord(event.queryStringParameters ?? {});
  // Raw stdout, so the line reaches CloudWatch as-is and is read as an embedded metric.
  if (record) process.stdout.write(`${violationLogLine(record, Date.now())}\n`);
  return { statusCode: 204, headers: { 'cache-control': 'no-store' } };
}
