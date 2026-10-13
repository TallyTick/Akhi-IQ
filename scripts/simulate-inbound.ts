import { computeHmacSha256 } from '../src/crypto/hmac.js';
import { getConfig } from '../src/config/env.js';
import { randomUUID } from 'node:crypto';

async function main() {
  const config = getConfig();

  // Parse basic CLI args
  const args = process.argv.slice(2);
  let from = '+15559998888';
  let to = '+15550001111';
  let text = 'Where is my order #1001?';
  let targetUrl = `http://localhost:${config.PORT}/webhooks/whatsapp`;
  let eventId = `sim_${randomUUID().slice(0, 8)}`;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) from = args[++i];
    if (args[i] === '--to' && args[i + 1]) to = args[++i];
    if (args[i] === '--message' && args[i + 1]) text = args[++i];
    if (args[i] === '--url' && args[i + 1]) targetUrl = args[++i];
    if (args[i] === '--eventId' && args[i + 1]) eventId = args[++i];
  }

  const payload = {
    eventId,
    from,
    to,
    body: text,
    whatsappMessageId: `wamid_${eventId}`,
    timestamp: new Date().toISOString(),
  };

  const rawJson = JSON.stringify(payload);
  const signatureHex = computeHmacSha256(rawJson, config.WHATSAPP_WEBHOOK_SECRET);
  const signatureHeader = `sha256=${signatureHex}`;

  console.log('--- Simulating Inbound WhatsApp Message ---');
  console.log(`URL:       ${targetUrl}`);
  console.log(`Event ID:  ${eventId}`);
  console.log(`From:      ${from}`);
  console.log(`To:        ${to}`);
  console.log(`Body:      "${text}"`);
  console.log(`Signature: ${signatureHeader}`);
  console.log('Sending POST request...');

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signatureHeader,
      },
      body: rawJson,
    });

    const status = response.status;
    const data = await response.json();

    console.log(`Response Status: ${status}`);
    console.log('Response Body:  ', JSON.stringify(data, null, 2));

    if (status === 200) {
      console.log('Success! Webhook acknowledged and enqueued.');
    } else {
      console.error('Webhook returned error status.');
    }
  } catch (err: any) {
    console.error('Request failed:', err.message);
    console.error('Make sure the API server is running on ' + targetUrl);
  }
}

main();
