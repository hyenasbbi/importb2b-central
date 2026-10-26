import {makeWebhook,clientFromEnvironment,supabaseStore} from './_uala-lifecycle.mjs';
import {adminClient} from './_client.mjs';
export const handler=makeWebhook({getStore:()=>supabaseStore(adminClient()),getProvider:()=>clientFromEnvironment()});
