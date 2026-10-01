export interface DateRange { from:Date; to:Date }
export interface ProviderSource { id:string; merchantName:string; mpan?:string|null; city?:string; storeId?:string }
export interface ProviderTransaction { sourceId:string;provider:string;reference:string;amount:number;transactionAt:Date;providerStatus:string }
export interface TransactionProvider {
  collectTransactions(source:ProviderSource,range:DateRange):Promise<ProviderTransaction[]>;
  getTransactionDetail(transaction:ProviderTransaction):Promise<ProviderTransaction>;
  healthCheck(source:ProviderSource):Promise<{status:'CONNECTED'|'LOGIN_REQUIRED'|'ERROR'|'NOT_CONFIGURED';lastSync?:Date}>;
}
