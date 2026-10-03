self.addEventListener('install',event=>{self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim())});

self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{}}catch{payload={body:event.data?.text?.()||''}}
  const title=payload.title||'IMPORTB2B';
  const options={
    body:payload.body||'',
    icon:payload.icon||'/assets/img/app-icon-512.png',
    badge:payload.badge||'/assets/img/app-icon-512.png',
    tag:payload.tag||'importb2b',
    renotify:true,
    silent:false,
    data:{url:payload.url||'/',...(payload.data||{})}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const raw=event.notification?.data?.url||'/';
  const target=new URL(raw,self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(new URL(client.url).origin===self.location.origin){
        if('navigate' in client)await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
