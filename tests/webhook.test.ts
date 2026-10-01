import {it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {signWebhook,publicAddress} from '../apps/worker/src/webhook.js';
it('signs timestamp and exact raw body',()=>{const body='{"event":"payment.paid"}';expect(signWebhook('test-secret','123',body)).toBe(createHmac('sha256','test-secret').update('123.'+body).digest('hex'));expect(signWebhook('test-secret','123',body)).not.toBe(signWebhook('test-secret','124',body));});
it('blocks local/private webhook destinations',()=>{for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.1.1','::1','::ffff:127.0.0.1'])expect(publicAddress(address)).toBe(false);expect(publicAddress('8.8.8.8')).toBe(true);});
