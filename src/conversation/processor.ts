import { TenantRepository, createTenantRepository, lookupTenantByWhatsAppNumber } from '../db/tenant.js';
import { ShopifyClient, ShopifyOrder } from '../shopify/types.js';
import { WhatsAppProvider } from '../whatsapp/provider.js';
import { OrderExtractor, detectIntent, extractEmail } from '../extractor/extractor.js';
import { HandoffNotifier } from '../handoff/notifier.js';
import { decryptAES256GCM } from '../crypto/aes.js';
import { createTenantLogger, logger } from '../logger/index.js';
import { getTemplates, SupportedLanguage } from '../templates/templates.js';
import { retryWithBackoff } from '../utils/retry.js';

export interface ProcessMessageParams {
  eventId: string;
  from: string; // Customer sender phone
  to: string; // Business WhatsApp number
  body: string;
  whatsappMessageId?: string;
  db: any;
  shopifyClient: ShopifyClient;
  whatsAppProvider: WhatsAppProvider;
  orderExtractor: OrderExtractor;
  handoffNotifier: HandoffNotifier;
  encryptionKey: Buffer;
  now?: Date; // For testing 24h window
}

export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/[^0-9]/g, '');
}

export function is24HourWindowOpen(lastMessageAt: Date | null | undefined, currentTime = new Date()): boolean {
  if (!lastMessageAt) return true; // First message
  const elapsedMs = currentTime.getTime() - new Date(lastMessageAt).getTime();
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  return elapsedMs <= TWENTY_FOUR_HOURS_MS;
}

export async function processInboundMessage(params: ProcessMessageParams): Promise<void> {
  const {
    eventId,
    from,
    to,
    body,
    whatsappMessageId,
    db,
    shopifyClient,
    whatsAppProvider,
    orderExtractor,
    handoffNotifier,
    encryptionKey,
    now = new Date(),
  } = params;

  // 1. Map receiving WhatsApp number to merchant tenant
  const tenantId = await lookupTenantByWhatsAppNumber(db, to);
  if (!tenantId) {
    logger.warn({ to, from, eventId }, 'Receiving WhatsApp number is not associated with an active merchant tenant');
    return;
  }

  const tenantRepo = createTenantRepository(db, tenantId);
  const tenantLog = createTenantLogger(tenantId, { from, to, eventId });

  // 2. RELIABILITY: Never send two replies to the same inbound message
  const alreadyReplied = await tenantRepo.hasRepliedToInboundEvent(eventId);
  if (alreadyReplied) {
    tenantLog.info({ eventId }, 'Outbound reply already recorded for this inbound event; skipping duplicate reply');
    return;
  }

  tenantLog.info({ bodyPreview: body.slice(0, 80) }, 'Processing inbound message for tenant');
  await tenantRepo.linkWebhookEvent(eventId, 'processing');

  // 3. Find or create conversation
  let conversation = await tenantRepo.findConversationByCustomerPhone(from);
  const isFirstMessage = !conversation;

  if (!conversation) {
    conversation = await tenantRepo.createConversation({
      customerPhone: from,
      status: 'active',
      lastCustomerMessageAt: now,
    });
  }

  // 4. Record inbound message
  await tenantRepo.createMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    sender: from,
    recipient: to,
    body,
    whatsappMessageId,
    status: 'received',
  });
  await tenantRepo.recordUsage('messages_inbound', 1);

  // 5. Language and entity extraction
  const extraction = await orderExtractor.extract(body);
  const detectedLang: SupportedLanguage = extraction.language || (conversation.language as SupportedLanguage) || 'en';
  const templates = getTemplates(detectedLang);

  // Update conversation last customer message time and language
  await tenantRepo.updateConversation(conversation.id, {
    lastCustomerMessageAt: now,
    language: detectedLang,
  });

  const merchant = await tenantRepo.getMerchant();
  const merchantEmail = merchant?.handoffEmail || undefined;

  // Helper to send outbound reply with deduplication key and retry
  const sendReply = async (text: string) => {
    const sent = await retryWithBackoff(
      () => whatsAppProvider.sendMessage(from, to, text),
      { name: 'WhatsAppSendMessage', maxRetries: 3 }
    );
    await tenantRepo.createMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      sender: to,
      recipient: from,
      body: text,
      whatsappMessageId: sent.messageId,
      inboundTriggerEventId: eventId,
      status: 'sent',
    });
    await tenantRepo.recordUsage('messages_outbound', 1);
    await tenantRepo.linkWebhookEvent(eventId, 'completed');
    return sent;
  };

  // Helper to escalate to human
  const escalateHandoff = async (reason: string, summary: string, replyMessage?: string) => {
    await tenantRepo.updateConversation(conversation.id, { status: 'needs_human' });
    await tenantRepo.createHandoff({
      conversationId: conversation.id,
      customerPhone: from,
      customerMessage: body,
      reason,
      summary,
      notifiedAt: new Date(),
    });
    await tenantRepo.recordUsage('handoffs', 1);

    await handoffNotifier.notifyMerchant({
      tenantId,
      conversationId: conversation.id,
      customerPhone: from,
      customerMessage: body,
      reason,
      summary,
      merchantEmail,
    });

    if (replyMessage) {
      await sendReply(replyMessage);
    }
  };

  // 6. RELIABILITY: WhatsApp 24-hour window check
  // If this conversation previously existed and more than 24 hours elapsed before this customer message:
  if (!isFirstMessage && conversation.lastCustomerMessageAt) {
    const windowOpen = is24HourWindowOpen(conversation.lastCustomerMessageAt, now);
    if (!windowOpen) {
      tenantLog.warn({ conversationId: conversation.id }, 'WhatsApp 24-hour messaging window has closed');
      await escalateHandoff(
        'window_closed',
        'Customer contacted outside 24-hour session window',
        templates.windowClosedPlaceholder()
      );
      return;
    }
  }

  // 7. If conversation already marked needs_human, remind customer gently
  if (conversation.status === 'needs_human') {
    await sendReply(templates.holdingInHandoff());
    return;
  }

  // 8. Intent detection
  const intent = detectIntent(body);
  const extractedOrderNum = extraction.orderNumber;
  const extractedEmail = extractEmail(body);

  tenantLog.info({ intent, extractedOrderNum, detectedLang, hasEmail: Boolean(extractedEmail) }, 'Detected intent and entities');

  // 9. Handle explicit refund or cancellation requests
  if (intent === 'refund_or_cancel') {
    await escalateHandoff(
      'refund_request',
      `Customer requested refund or cancellation: "${body}"`,
      templates.humanHandoff()
    );
    return;
  }

  // 10. Handle angry customer complaints
  if (intent === 'angry_complaint') {
    await escalateHandoff(
      'angry_customer',
      `Angry customer complaint or dispute: "${body}"`,
      templates.humanHandoff()
    );
    return;
  }

  // 11. Handle explicit human agent requests
  if (intent === 'human_request') {
    await escalateHandoff(
      'human_requested',
      `Customer requested human representative: "${body}"`,
      templates.humanHandoff()
    );
    return;
  }

  // Determine target order number to look up
  let targetOrderNumber = extractedOrderNum || conversation.pendingOrderNumber;

  // 12. If unclear intent and no order number / pending order number and no email: handoff
  if (intent === 'unclear' && !targetOrderNumber && !extractedEmail) {
    await escalateHandoff(
      'unclear_intent',
      `Unclear customer message: "${body}"`,
      templates.humanHandoff()
    );
    return;
  }

  // 13. Retrieve Shopify installation and decrypt token
  const shopifyInstall = await tenantRepo.getShopifyInstallation();
  if (!shopifyInstall) {
    tenantLog.error('Shopify installation missing for tenant');
    await escalateHandoff('store_not_configured', 'Merchant Shopify store integration missing');
    return;
  }

  const decryptedToken = decryptAES256GCM(shopifyInstall.accessTokenEncrypted, encryptionKey);

  // 14. SMARTER UNDERSTANDING: If customer gives NO order number but their phone matches, look up recent orders
  if (!targetOrderNumber && !extractedEmail) {
    try {
      const recentOrders = await retryWithBackoff(
        () => shopifyClient.getRecentOrdersByPhone(shopifyInstall.shopDomain, decryptedToken, from),
        { name: 'ShopifyRecentOrders', maxRetries: 3 }
      );
      await tenantRepo.recordUsage('orders_looked_up', 1);

      if (recentOrders.length === 1) {
        // Exactly one recent order found matching their phone!
        const order = recentOrders[0];
        tenantLog.info({ orderNumber: order.orderNumber }, 'Found single recent order matching customer phone');
        await tenantRepo.updateConversation(conversation.id, {
          verifiedAt: new Date(),
          verifiedOrderId: order.id,
          pendingOrderNumber: null,
          failedOrderLookupCount: 0,
        });

        await sendReply(templates.recentOrdersFoundSingle(order));
        return;
      }

      if (recentOrders.length > 1) {
        // Multiple recent orders found!
        tenantLog.info({ count: recentOrders.length }, 'Found multiple recent orders matching customer phone');
        await sendReply(templates.recentOrdersFoundMultiple(recentOrders));
        return;
      }

      // No recent orders found under this phone
      await sendReply(templates.askForOrderNumber());
      return;
    } catch (err: any) {
      tenantLog.error({ err: err?.message }, 'Failed to look up recent orders by phone after retries');
      await escalateHandoff('system_error', `Failed looking up orders: ${err?.message}`);
      return;
    }
  }

  // 15. Lookup single order by order number with retry
  let order: ShopifyOrder | null = null;
  if (targetOrderNumber) {
    try {
      order = await retryWithBackoff(
        () => shopifyClient.getOrder(shopifyInstall.shopDomain, decryptedToken, targetOrderNumber!),
        { name: 'ShopifyGetOrder', maxRetries: 3 }
      );
      await tenantRepo.recordUsage('orders_looked_up', 1);
    } catch (err: any) {
      tenantLog.error({ err: err?.message }, 'Shopify order lookup failed after retries');
      await escalateHandoff('system_error', `Shopify API error after retries: ${err?.message}`);
      return;
    }
  }

  // 16. RELIABILITY: Handle non-existent order number (2 failed tries before handoff)
  if (!order && targetOrderNumber) {
    const failedCount = conversation.failedOrderLookupCount || 0;
    tenantLog.warn({ targetOrderNumber, failedCount }, 'Order not found in Shopify');

    if (failedCount === 0) {
      // First failed attempt: ask politely to check number
      await tenantRepo.updateConversation(conversation.id, {
        failedOrderLookupCount: 1,
      });
      await sendReply(templates.orderNotFoundFirstTry(targetOrderNumber));
      return;
    } else {
      // Second failed attempt: hand off to human support
      await escalateHandoff(
        'order_not_found',
        `Order not found after two failed tries: #${targetOrderNumber}`,
        templates.orderNotFoundFinalHandoff(targetOrderNumber)
      );
      return;
    }
  }

  if (!order) {
    await sendReply(templates.askForOrderNumber());
    return;
  }

  // 17. IDENTITY CHECK BEFORE SHARING ANY ORDER DATA
  const normalizedSenderPhone = normalizePhone(from);
  const normalizedOrderPhone = normalizePhone(order.customerPhone);

  const isPhoneMatch =
    normalizedOrderPhone.length > 0 &&
    (normalizedSenderPhone === normalizedOrderPhone ||
      normalizedSenderPhone.endsWith(normalizedOrderPhone) ||
      normalizedOrderPhone.endsWith(normalizedSenderPhone));

  if (isPhoneMatch) {
    // Verified by sender phone!
    tenantLog.info({ targetOrderNumber }, 'Identity verified via sender phone match');
    await tenantRepo.updateConversation(conversation.id, {
      verifiedAt: new Date(),
      verifiedOrderId: order.id,
      pendingOrderNumber: null,
      failedOrderLookupCount: 0,
    });

    await sendReply(templates.orderStatus(order));
    return;
  }

  // Phone did NOT match. Check email fallback
  if (extractedEmail) {
    const orderEmail = (order.customerEmail || '').toLowerCase().trim();
    if (orderEmail && extractedEmail.toLowerCase() === orderEmail) {
      // Verified via email match!
      tenantLog.info({ targetOrderNumber, extractedEmail }, 'Identity verified via email match');
      await tenantRepo.updateConversation(conversation.id, {
        verifiedAt: new Date(),
        verifiedOrderId: order.id,
        verifiedEmail: extractedEmail,
        pendingOrderNumber: null,
        failedOrderLookupCount: 0,
      });

      await sendReply(templates.orderStatus(order));
      return;
    } else {
      // Email was provided but DID NOT match order email!
      tenantLog.warn({ targetOrderNumber, extractedEmail }, 'Identity verification failed: email mismatch');
      await escalateHandoff(
        'unverified',
        `Provided email ${extractedEmail} did not match order #${targetOrderNumber}`,
        templates.unverifiedEmailFailed(targetOrderNumber!)
      );
      return;
    }
  }

  // Phone does not match and no email was provided yet: Prompt for email
  tenantLog.info({ targetOrderNumber }, 'Sender phone does not match order phone. Requesting order number + email verification.');
  await tenantRepo.updateConversation(conversation.id, {
    pendingOrderNumber: targetOrderNumber,
  });

  await sendReply(templates.unverifiedPhonePrompt(targetOrderNumber!));
}
