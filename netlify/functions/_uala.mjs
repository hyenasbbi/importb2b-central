// API Cobros Online v2. Server-only; never import from browser assets.
export const READINESS = Object.freeze({ enabled: false, plans: [], reason: 'Pendiente validación oficial de planes, reservas y liquidación. Cobros no habilitados.' });
const ceilDiv = (a,b) => (a+b-1n)/b;
export function quote(netCents, processingBps=490, financingBps=0, vatBps=2100) {
  if (![netCents,processingBps,financingBps,vatBps].every(Number.isSafeInteger) || netCents<=0 || [processingBps,financingBps,vatBps].some(x=>x<0||x>10000)) throw new Error('Importe o tasas inválidas');
  const scale=100000000n, rate=BigInt(processingBps+financingBps)*BigInt(10000+vatBps), denominator=scale-rate;
  if (denominator<=0n) throw new Error('Comisiones inválidas');
  // ceil in ARS, then convert to the integer cents required by v2.
  const finalCents=ceilDiv(BigInt(netCents)*scale,denominator*100n)*100n;
  // Conservative: round processing, financing and their IVA individually upward.
  let gross=finalCents;
  const costs = value => {
    const processing=ceilDiv(value*BigInt(processingBps),10000n), financing=ceilDiv(value*BigInt(financingBps),10000n);
    const processingVat=ceilDiv(processing*BigInt(vatBps),10000n), financingVat=ceilDiv(financing*BigInt(vatBps),10000n);
    return {processing,financing,processingVat,financingVat,fee:processing+financing+processingVat+financingVat};
  };
  if(gross>999999900n || gross<2500n) throw new Error('Importe fuera del rango oficial de Ualá');
  let c=costs(gross);
  while(gross-c.fee<BigInt(netCents)){
    gross+=100n;
    if(gross>999999900n)throw new Error('Importe fuera del rango oficial de Ualá');
    c=costs(gross);
  }
  if(gross>999999900n || gross<2500n) throw new Error('Importe fuera del rango oficial de Ualá');
  return {net_cents:netCents,final_cents:Number(gross),processing_bps:processingBps,financing_bps:financingBps,vat_bps:vatBps,processing_cents:Number(c.processing),financing_cents:Number(c.financing),processing_vat_cents:Number(c.processingVat),financing_vat_cents:Number(c.financingVat),fee_cents:Number(c.fee),estimated_net_cents:Number(gross-c.fee)};
}
export function verifiedOrder(remote, expected) {
  if(remote.uuid!==expected.provider_id || remote.external_reference!==expected.external_reference || !Number.isSafeInteger(remote.amount) || remote.amount!==expected.final_cents) throw new Error('Orden de Ualá no coincide');
  if(!['PENDING','PROCESSED','REJECTED','APPROVED','REFUNDED'].includes(remote.status)) throw new Error('Estado no reconocido');
  // Whitelist only. Never persist customer/card/PAN or full provider responses.
  return {provider_id:remote.uuid,status:remote.status,amount_cents:remote.amount,external_reference:remote.external_reference};
}
export class UalaClient {
  constructor({environment,username,clientId,clientSecret,fetchImpl=fetch}){
    if(!['test','production'].includes(environment))throw new Error('Ambiente Ualá inválido');
    if(!username||!clientId||!clientSecret)throw new Error('Faltan credenciales Ualá');
    const stage=environment==='test'?'.stage':'';
    this.auth=`https://auth${stage}.developers.ar.ua.la/v2/api/auth/token`;
    this.base=`https://checkout${stage}.developers.ar.ua.la/v2/api`;
    this.credentials={username,client_id:clientId,client_secret_id:clientSecret,grant_type:'client_credentials'};
    this.fetch=fetchImpl;
  }
  async request(url,options){
    // No automatic POST retries: provider idempotency is not documented.
    const r=await this.fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error(`Ualá HTTP ${r.status}`);
    return r.json();
  }
  async token(){
    if(this.accessToken && Date.now()<this.expiresAt)return this.accessToken;
    const r=await this.request(this.auth,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(this.credentials)});
    if(typeof r.access_token!=='string'||!Number.isFinite(r.expires_in)||r.expires_in<=60)throw new Error('Token Ualá inválido');
    this.accessToken=r.access_token;this.expiresAt=Date.now()+(Math.min(r.expires_in,86400)-60)*1000;
    return this.accessToken;
  }
  async call(path,body){
    const token=await this.token();
    return this.request(this.base+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})});
  }
  getOrder(id){if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('UUID inválido');return this.call(`/orders/${id}`);}
  createOrder({amountCents,description,successUrl,failUrl,notificationUrl,externalReference}){
    if(!Number.isSafeInteger(amountCents)||amountCents<2500||amountCents>999999900)throw new Error('Importe inválido');
    for(const u of [successUrl,failUrl,notificationUrl])if(new URL(u).protocol!=='https:')throw new Error('Se requiere HTTPS');
    if(!externalReference||!description)throw new Error('Falta referencia o descripción');
    return this.call('/checkout',{amount:String(amountCents),description,callback_success:successUrl,callback_fail:failUrl,notification_url:notificationUrl,external_reference:externalReference});
  }
  refund(id,amountCents,notificationUrl){
    if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(amountCents)||amountCents<=0||new URL(notificationUrl).protocol!=='https:')throw new Error('Devolución inválida');
    return this.call(`/orders/${id}/refund`,{amount:String(amountCents),notification_url:notificationUrl});
  }
}
