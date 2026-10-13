import { createHmac, timingSafeEqual } from 'node:crypto';

export function computeHmacSha256(payload: string | Buffer, secret: string): string {
  return createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

export function verifyHmacSha256(
  payload: string | Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  // Header may be formatted as "sha256=abcdef..." or raw hex "abcdef..."
  const cleanSignature = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader;

  if (!/^[0-9a-fA-F]{64}$/.test(cleanSignature)) {
    return false;
  }

  const expectedHex = computeHmacSha256(payload, secret);

  const expectedBuffer = Buffer.from(expectedHex, 'hex');
  const actualBuffer = Buffer.from(cleanSignature, 'hex');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
