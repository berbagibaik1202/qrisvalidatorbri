import {it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {verifyWebhook} from '../apps/mini-pos/webhook.js';
it('validates raw body, timestamp and tampering',()=>{
  const secret='test-webhook-secret',timestamp='1790841600',body=Buffer.from('{"event":"payment.paid"}');
  const signature=createHmac('sha256',secret).update(timestamp+'.').update(body).digest('hex');
  expect(verifyWebhook(secret,timestamp,body,signature,Number(timestamp)*1000)).toBe(true);
  expect(verifyWebhook(secret,timestamp,Buffer.from('{}'),signature,Number(timestamp)*1000)).toBe(false);
  expect(verifyWebhook(secret,timestamp,body,signature,(Number(timestamp)+301)*1000)).toBe(false);
  expect(verifyWebhook(secret,timestamp,body,'malformed',Number(timestamp)*1000)).toBe(false);
});
