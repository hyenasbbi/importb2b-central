import { READINESS } from './_uala.mjs';
// Fail closed until the documented provider gaps and atomic settlement are resolved.
// Never create an order, reserve inventory or register Caja from this staged route.
export async function handler(event){
  return {statusCode:event.httpMethod==='POST'?503:405,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify({code:'UALA_NOT_READY',error:READINESS.reason})};
}
