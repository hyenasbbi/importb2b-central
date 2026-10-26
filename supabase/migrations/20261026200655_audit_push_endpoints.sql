-- Protect every sender, including scheduled senders, without deleting subscriptions.
-- jmt17 is a legacy Chromium endpoint; retained for the existing device.
alter table public.importb2b_push_subscriptions add constraint audit_push_provider
 check (endpoint ~ '^https://(fcm[.]googleapis[.]com|jmt17[.]google[.]com|updates[.]push[.]services[.]mozilla[.]com|[a-zA-Z0-9.-]+[.]push[.]apple[.]com|[a-zA-Z0-9.-]+[.]notify[.]windows[.]com)(:443)?/') not valid;
alter table public.importb2b_push_subscriptions validate constraint audit_push_provider;
