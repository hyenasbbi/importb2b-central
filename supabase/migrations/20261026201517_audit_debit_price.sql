-- Ley 25.065 art.37 / Res.51/2017 art.1: no surcharge for debit in one payment.
-- Only the configured method of this storefront changes. Past orders and base prices remain intact.
update public.importb2b_payment_methods m
set adjustment_kind='none',adjustment_value=0
where m.code='debit' and m.adjustment_direction='surcharge' and m.adjustment_value>0
and exists(select 1 from public.importb2b_catalog_settings c where c.owner_id=m.owner_id and c.public_slug='importb2b');
