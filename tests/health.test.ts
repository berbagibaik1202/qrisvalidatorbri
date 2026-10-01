import {describe,it,expect} from 'vitest';
import {collectorHealth,workerHealth} from '../apps/api/src/system-health.js';
import type {SessionHealth} from '../providers/bri-merchant/config.js';
const now=Date.now();
const provider:SessionHealth={status:'CONNECTED',browserOpen:true,loginUrl:'',transactionsUrl:'',lastCheck:new Date(now).toISOString(),lastSync:new Date(now).toISOString(),collector:'READY',message:'Connected'};
describe('operational health',()=>{
  it('distinguishes connected sessions from stale or failed collectors',()=>{
    expect(collectorHealth(provider,now).status).toBe('HEALTHY');
    expect(collectorHealth({...provider,lastSync:new Date(now-180000).toISOString()},now).status).toBe('DEGRADED');
    expect(collectorHealth({...provider,collector:'ERROR'},now).status).toBe('ERROR');
    expect(collectorHealth({...provider,status:'LOGIN_REQUIRED'},now).status).toBe('OFFLINE');
    expect(collectorHealth({...provider,lastSync:'invalid'},now).status).toBe('DEGRADED');
  });
  it('does not report stale worker heartbeats as healthy',()=>{
    expect(workerHealth({status:'HEALTHY',lastCheck:new Date(now)},now).status).toBe('HEALTHY');
    expect(workerHealth({status:'HEALTHY',lastCheck:new Date(now-180000)},now).status).toBe('OFFLINE');
    expect(workerHealth({status:'ERROR',lastCheck:new Date(now)},now).status).toBe('ERROR');
    expect(workerHealth(null,now).status).toBe('OFFLINE');
  });
});
