-- User requested every non-Jordan imported short in Version Jugador.
-- Metadata only; no visibility, inventory, prices, variants or sale changes.
begin;
set local lock_timeout='5s';
lock table public.importb2b_products in share row exclusive mode;
with before_rows as materialized (
  select p.*, case when p.name ilike '%jordan%' then 'Jordan Dri Fit'
    else 'Versión Jugador' end as target_subcategory
  from public.importb2b_products p
  where p.owner_id=(select owner_id from public.importb2b_catalog_settings where public_slug='importb2b')
    and p.category in ('Shores Importados','Shorts Importados')
), changed as (
  update public.importb2b_products p set subcategory=b.target_subcategory
  from before_rows b where p.id=b.id and p.subcategory is distinct from b.target_subcategory
  returning p.*
)
insert into public.audit_log(entity_type,entity_id,action,old_data,new_data)
select 'importb2b_products',c.id,'UPDATE',
  to_jsonb(b)-'target_subcategory',
  to_jsonb(c)||jsonb_build_object('_reason','User authorized imported shorts subcategories, 2026-10-20')
from changed c join before_rows b on b.id=c.id;
commit;
