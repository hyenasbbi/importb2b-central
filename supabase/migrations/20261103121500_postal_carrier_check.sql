-- Restrict postal shipments to the carriers offered by the public checkout.
-- The database enforces this independently of client-side select options.
alter table public.importb2b_web_orders
  add constraint importb2b_web_orders_postal_carrier_check
  check (
    coalesce(shipping_details->>'zone','') <> 'postal'
    or coalesce(shipping_details->>'carrier','') in ('Andreani','Vía Cargo')
  );
