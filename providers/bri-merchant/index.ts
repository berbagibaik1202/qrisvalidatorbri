import type {TransactionProvider,ProviderSource,DateRange,ProviderTransaction} from '../../packages/provider-core/src/index.js';
import {BriBrowserSession} from './browser.js';
import {BriNetworkCollector} from './network.js';
export class BriMerchantProvider implements TransactionProvider {
  readonly network:BriNetworkCollector;
  constructor(readonly session=new BriBrowserSession()){this.network=new BriNetworkCollector(session);}
  async collectTransactions(source:ProviderSource,range:DateRange){
    return this.network.collect(source,range);
  }
  async getTransactionDetail(transaction:ProviderTransaction):Promise<ProviderTransaction>{if(transaction.providerStatus!=='SUCCESS')throw new Error('BRI_DETAIL_MAPPING_REQUIRED');return transaction;}
  async healthCheck(_source:ProviderSource){const health=await this.session.check();return {status:health.status==='DISABLED'||health.status==='BROWSER_OFFLINE'?'LOGIN_REQUIRED' as const:health.status,lastSync:health.lastSync?new Date(health.lastSync):undefined};}
}
