import { describe, expect, it, vi } from 'vitest';
import { EmailHandoffNotifier, EmailHandoffStub } from '../src/handoff/email.js';
import { ResendEmailProvider } from '../src/handoff/resend.js';
import { HandoffNotificationData } from '../src/handoff/notifier.js';

const handoff: HandoffNotificationData = {
  tenantId: 'tenant-email-test',
  conversationId: 'conversation-email-test',
  merchantEmail: 'merchant@example.com',
  customerPhone: '+15551234567',
  customerMessage: 'Please help with <order>',
  reason: 'human_requested',
  orderNumber: '1003',
  occurredAt: new Date('2026-10-17T12:00:00.000Z'),
};

describe('Resend email provider', () => {
  it('sends handoff alerts with text and escaped HTML content', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const notifier = new EmailHandoffNotifier(
      new ResendEmailProvider('resend-test-api-key', 'Support <support@example.com>', fetchMock)
    );

    await notifier.notifyMerchant(handoff);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(request?.method).toBe('POST');
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer resend-test-api-key',
      'content-type': 'application/json',
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    const sent = JSON.parse(String(request?.body));
    expect(sent).toMatchObject({
      from: 'Support <support@example.com>',
      to: ['merchant@example.com'],
      subject: 'Customer needs help - order #1003',
      text: expect.stringContaining('Please help with <order>'),
      html: expect.stringContaining('Please help with &lt;order&gt;'),
    });
    expect(sent.text).toContain('Reason: human_requested');
    expect(sent.text).toContain('Customer phone: +15551234567');
    expect(sent.text).toContain('Order number: #1003');
    expect(sent.text).toContain('Time: 2026-10-17T12:00:00.000Z');
  });

  it('does not retry 4xx responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 422 }));
    const provider = new ResendEmailProvider('resend-test-api-key', 'support@example.com', fetchMock);

    await expect(provider.sendEmail({
      to: 'merchant@example.com',
      subject: 'Test',
      text: 'Test',
      html: '<p>Test</p>',
    })).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 5xx responses and succeeds when Resend recovers', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const provider = new ResendEmailProvider('resend-test-api-key', 'support@example.com', fetchMock);

    await expect(provider.sendEmail({
      to: 'merchant@example.com',
      subject: 'Test',
      text: 'Test',
      html: '<p>Test</p>',
    })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('suppresses duplicate handoff alerts for the same conversation within ten minutes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const notifier = new EmailHandoffNotifier(
      new ResendEmailProvider('resend-test-api-key', 'support@example.com', fetchMock)
    );

    await notifier.notifyMerchant(handoff);
    await notifier.notifyMerchant({ ...handoff, reason: 'unclear_intent' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends monthly summaries through the same provider', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const notifier = new EmailHandoffNotifier(
      new ResendEmailProvider('resend-test-api-key', 'support@example.com', fetchMock)
    );

    await notifier.sendMonthlySummary({
      tenantId: handoff.tenantId,
      merchantEmail: 'merchant@example.com',
      year: 2026,
      month: 10,
      totalConversations: 5,
      conversationsHandledAutomatically: 4,
      conversationsHandedOff: 1,
      estimatedHoursSaved: 0.7,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    const sent = JSON.parse(String(request?.body));
    expect(sent.to).toEqual(['merchant@example.com']);
    expect(sent.subject).toBe('Monthly automation summary - 2026-10');
    expect(sent.text).toContain('Handled automatically: 4');
    expect(sent.html).toContain('Estimated hours saved');
  });

  it('keeps stub mode from making external email requests', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const stub = new EmailHandoffStub();

    await stub.notifyMerchant(handoff);
    await stub.sendMonthlySummary({
      tenantId: handoff.tenantId,
      merchantEmail: handoff.merchantEmail!,
      year: 2026,
      month: 10,
      totalConversations: 2,
      conversationsHandledAutomatically: 1,
      conversationsHandedOff: 1,
      estimatedHoursSaved: 0.2,
    });

    expect(stub.notifications).toHaveLength(1);
    expect(stub.monthlySummaries).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
