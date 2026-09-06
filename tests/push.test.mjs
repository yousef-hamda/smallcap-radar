import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';

test('creates an encrypted, VAPID-signed Web Push request', () => {
  const vapid = webpush.generateVAPIDKeys();
  const client = createECDH('prime256v1');
  client.generateKeys();
  const details = webpush.generateRequestDetails({
    endpoint: 'https://push.example.test/message',
    keys: {
      p256dh: client.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  }, JSON.stringify({ title: 'اكتمل الفحص' }), {
    TTL: 86_400,
    vapidDetails: { subject: 'mailto:test@example.com', publicKey: vapid.publicKey, privateKey: vapid.privateKey },
  });
  assert.equal(details.method, 'POST');
  assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
  assert.ok(details.headers.Authorization);
  assert.ok(details.body.length > 0);
});
