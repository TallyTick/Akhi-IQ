import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createTenantRepository } from '../../db/tenant.js';
import { getConfig } from '../../config/env.js';
import { createDefaultHandoffNotifier } from '../../handoff/email.js';
import { HandoffNotifier } from '../../handoff/notifier.js';

export function registerSettingsRoutes(
  app: FastifyInstance,
  options: { db: any; handoffNotifier?: HandoffNotifier }
) {
  const notifier = options.handoffNotifier || createDefaultHandoffNotifier();

  // Render HTML settings page
  app.get('/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as any;
    const merchantId = query.merchantId || 'merchant_acme_001';

    const tenantRepo = createTenantRepository(options.db, merchantId);
    const merchant = await tenantRepo.getMerchant();

    const handoffEmail = merchant?.handoffEmail || 'support@merchant.com';
    const customTemplates = merchant?.customTemplates || '{}';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Merchant Support Settings - Akhi-IQ</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f6f8; margin: 0; padding: 40px; }
    .card { background: white; max-width: 650px; margin: 0 auto 30px auto; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { margin-top: 0; color: #202223; font-size: 24px; }
    label { display: block; font-weight: 600; margin-top: 15px; margin-bottom: 6px; color: #444; }
    input[type="text"], input[type="email"], textarea { width: 100%; padding: 10px; border: 1px solid #c9cccf; border-radius: 4px; box-sizing: border-box; font-size: 14px; }
    textarea { height: 100px; font-family: monospace; }
    button { background: #008060; color: white; border: none; padding: 12px 20px; font-size: 15px; font-weight: 600; border-radius: 4px; cursor: pointer; margin-top: 20px; }
    button:hover { background: #006e52; }
    .secondary-btn { background: #5c5f62; margin-left: 10px; }
    .secondary-btn:hover { background: #45474a; }
    .badge { display: inline-block; background: #e3f1df; color: #008060; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <h1>Merchant Settings</h1>
      <span class="badge">Merchant: ${merchantId}</span>
    </div>
    <form method="POST" action="/settings?merchantId=${encodeURIComponent(merchantId)}">
      <label for="handoffEmail">Handoff Alert Email Address</label>
      <input type="email" id="handoffEmail" name="handoffEmail" value="${escapeHtml(handoffEmail)}" required>
      <small style="color: #6d7175;">Customer support desk email where escalated WhatsApp threads are dispatched.</small>

      <label for="customTemplates">Custom Reply Wording / Templates (JSON)</label>
      <textarea id="customTemplates" name="customTemplates">${escapeHtml(customTemplates)}</textarea>
      <small style="color: #6d7175;">Optional JSON object with custom template overrides.</small>

      <div>
        <button type="submit">Save Settings</button>
      </div>
    </form>
  </div>

  <div class="card">
    <h2>Monthly Automation Summary Report</h2>
    <p style="color: #6d7175; font-size: 14px;">Trigger a monthly performance email detailing automated resolutions, human handoffs, and estimated hours saved.</p>
    <form method="POST" action="/merchants/${encodeURIComponent(merchantId)}/reports/monthly">
      <button type="submit" class="secondary-btn" style="margin-left: 0;">Send Monthly Summary Email Now</button>
    </form>
  </div>
</body>
</html>`;

    return reply.type('text/html').send(html);
  });

  // Save merchant settings
  app.post('/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as any;
    const body = request.body as any;
    const merchantId = query.merchantId || body?.merchantId || 'merchant_acme_001';

    const handoffEmail = body?.handoffEmail;
    const customTemplates = body?.customTemplates;

    const tenantRepo = createTenantRepository(options.db, merchantId);
    await tenantRepo.updateMerchant({
      handoffEmail,
      customTemplates,
    });

    if (request.headers.accept?.includes('application/json')) {
      return reply.send({ status: 'ok', merchantId, handoffEmail });
    }

    return reply.redirect(`/settings?merchantId=${encodeURIComponent(merchantId)}`);
  });

  // Trigger monthly summary email
  app.post('/merchants/:merchantId/reports/monthly', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as any;
    const merchantId = params.merchantId;
    const query = request.query as any;

    const now = new Date();
    const year = Number(query.year || now.getUTCFullYear());
    const month = Number(query.month || now.getUTCMonth() + 1);

    const tenantRepo = createTenantRepository(options.db, merchantId);
    const merchant = await tenantRepo.getMerchant();
    const summary = await tenantRepo.getMonthlySummary(year, month);

    const recipientEmail = merchant?.handoffEmail ||
      (getConfig().EMAIL_PROVIDER === 'stub' ? 'support@merchant.com' : undefined);
    if (!recipientEmail) {
      return reply.status(400).send({ error: 'Merchant handoff email is not configured' });
    }

    await notifier.sendMonthlySummary({
      tenantId: merchantId,
      merchantEmail: recipientEmail,
      year: summary.year,
      month: summary.month,
      totalConversations: summary.totalConversations,
      conversationsHandledAutomatically: summary.conversationsHandledAutomatically,
      conversationsHandedOff: summary.conversationsHandedOff,
      estimatedHoursSaved: summary.estimatedHoursSaved,
    });

    return reply.send({
      status: 'ok',
      report: summary,
      recipientEmail,
    });
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
