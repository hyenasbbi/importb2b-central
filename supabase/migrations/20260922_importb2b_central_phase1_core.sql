-- IMPORTB2B Central - Phase 1
-- Additive migration: does not delete or rewrite existing app data.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.importb2b_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.importb2b_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sku text,
  name text not null,
  category text,
  description text,
  primary_image_url text,
  active boolean not null default true,
  catalog_visible boolean not null default true,
  source text,
  source_id text,
  source_payload jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists importb2b_products_owner_sku_uidx
on public.importb2b_products(owner_id, lower(sku)) where sku is not null and btrim(sku) <> '';
create unique index if not exists importb2b_products_source_uidx
on public.importb2b_products(owner_id, source, source_id) where source is not null and source_id is not null;
create index if not exists importb2b_products_owner_category_idx on public.importb2b_products(owner_id, category);
create index if not exists importb2b_products_owner_active_idx on public.importb2b_products(owner_id, active);
create index if not exists importb2b_products_search_trgm_idx on public.importb2b_products using gin (search_text extensions.gin_trgm_ops);

create table if not exists public.importb2b_product_aliases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.importb2b_products(id) on delete cascade,
  alias text not null,
  created_at timestamptz not null default now(),
  unique(owner_id, product_id, alias)
);
create index if not exists importb2b_product_aliases_search_trgm_idx on public.importb2b_product_aliases using gin (alias extensions.gin_trgm_ops);

create table if not exists public.importb2b_product_images (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.importb2b_products(id) on delete cascade,
  image_url text,
  storage_path text,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists importb2b_product_images_product_idx on public.importb2b_product_images(product_id, sort_order);

create table if not exists public.importb2b_product_variants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.importb2b_products(id) on delete cascade,
  sku text,
  variant_name text not null default 'Única',
  attributes jsonb not null default '{}'::jsonb,
  cost_ars numeric(14,2),
  price_ars numeric(14,2),
  wholesale_price_ars numeric(14,2),
  stock_min numeric(14,3) not null default 0,
  active boolean not null default true,
  source text,
  source_id text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists importb2b_product_variants_owner_sku_uidx
on public.importb2b_product_variants(owner_id, lower(sku)) where sku is not null and btrim(sku) <> '';
create unique index if not exists importb2b_product_variants_source_uidx
on public.importb2b_product_variants(owner_id, source, source_id) where source is not null and source_id is not null;
create index if not exists importb2b_product_variants_product_idx on public.importb2b_product_variants(product_id, active);
create index if not exists importb2b_product_variants_name_trgm_idx on public.importb2b_product_variants using gin (variant_name extensions.gin_trgm_ops);

create table if not exists public.importb2b_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.importb2b_products(id) on delete cascade,
  variant_id uuid not null references public.importb2b_product_variants(id) on delete cascade,
  bucket text not null check (bucket in ('on_hand','reserved','in_transit')),
  movement_type text not null check (movement_type in (
    'opening','kyte_import','purchase_order','purchase_receipt','sale','sale_cancel',
    'reservation','reservation_release','return','adjustment','loss','transfer'
  )),
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  unit_cost_ars numeric(14,2),
  reference_type text,
  reference_id text,
  note text,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists importb2b_inventory_movements_variant_idx on public.importb2b_inventory_movements(variant_id, occurred_at desc);
create index if not exists importb2b_inventory_movements_reference_idx on public.importb2b_inventory_movements(reference_type, reference_id);
create index if not exists importb2b_inventory_movements_owner_date_idx on public.importb2b_inventory_movements(owner_id, occurred_at desc);

create or replace view public.importb2b_stock_summary
with (security_invoker = true)
as
select
  v.owner_id,
  v.product_id,
  v.id as variant_id,
  coalesce(sum(m.quantity_delta) filter (where m.bucket='on_hand'),0)::numeric(14,3) as on_hand,
  coalesce(sum(m.quantity_delta) filter (where m.bucket='reserved'),0)::numeric(14,3) as reserved,
  coalesce(sum(m.quantity_delta) filter (where m.bucket='in_transit'),0)::numeric(14,3) as in_transit,
  (coalesce(sum(m.quantity_delta) filter (where m.bucket='on_hand'),0) -
   coalesce(sum(m.quantity_delta) filter (where m.bucket='reserved'),0))::numeric(14,3) as available
from public.importb2b_product_variants v
left join public.importb2b_inventory_movements m on m.variant_id=v.id
group by v.owner_id, v.product_id, v.id;

create table if not exists public.importb2b_customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_code text,
  full_name text not null,
  phone text,
  phone2 text,
  email text,
  document_number text,
  address text,
  address_extra text,
  instagram_username text,
  notes text,
  active boolean not null default true,
  source text,
  source_id text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists importb2b_customers_code_uidx
on public.importb2b_customers(owner_id, lower(customer_code)) where customer_code is not null and btrim(customer_code) <> '';
create unique index if not exists importb2b_customers_source_uidx
on public.importb2b_customers(owner_id, source, source_id) where source is not null and source_id is not null;
create index if not exists importb2b_customers_name_trgm_idx on public.importb2b_customers using gin (full_name extensions.gin_trgm_ops);
create index if not exists importb2b_customers_phone_idx on public.importb2b_customers(owner_id, phone);

create table if not exists public.importb2b_sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sale_code text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled','refunded')),
  customer_id uuid references public.importb2b_customers(id) on delete set null,
  subtotal_ars numeric(14,2) not null default 0,
  discount_ars numeric(14,2) not null default 0,
  fee_ars numeric(14,2) not null default 0,
  shipping_ars numeric(14,2) not null default 0,
  total_ars numeric(14,2) not null default 0,
  profit_ars numeric(14,2),
  original_payment_method text,
  notes text,
  seller_name text,
  source text,
  source_id text,
  source_payload jsonb not null default '{}'::jsonb,
  sold_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, sale_code)
);
create unique index if not exists importb2b_sales_source_uidx
on public.importb2b_sales(owner_id, source, source_id) where source is not null and source_id is not null;
create index if not exists importb2b_sales_owner_date_idx on public.importb2b_sales(owner_id, sold_at desc);
create index if not exists importb2b_sales_customer_idx on public.importb2b_sales(customer_id, sold_at desc);

create table if not exists public.importb2b_sale_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sale_id uuid not null references public.importb2b_sales(id) on delete cascade,
  product_id uuid references public.importb2b_products(id) on delete set null,
  variant_id uuid references public.importb2b_product_variants(id) on delete set null,
  original_item_name text not null,
  quantity numeric(14,3) not null default 1,
  unit_price_ars numeric(14,2),
  unit_cost_ars numeric(14,2),
  line_total_ars numeric(14,2),
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists importb2b_sale_items_sale_idx on public.importb2b_sale_items(sale_id);
create index if not exists importb2b_sale_items_variant_idx on public.importb2b_sale_items(variant_id);

create table if not exists public.importb2b_payment_methods (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  name text not null,
  adjustment_kind text not null default 'none' check (adjustment_kind in ('none','percent','fixed')),
  adjustment_direction text not null default 'surcharge' check (adjustment_direction in ('surcharge','discount')),
  adjustment_value numeric(14,4) not null default 0,
  creates_settlement boolean not null default false,
  settlement_days integer,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, code)
);

create table if not exists public.importb2b_sale_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sale_id uuid not null references public.importb2b_sales(id) on delete cascade,
  payment_method_id uuid references public.importb2b_payment_methods(id) on delete set null,
  base_amount_ars numeric(14,2) not null default 0,
  adjustment_amount_ars numeric(14,2) not null default 0,
  amount_ars numeric(14,2) not null default 0,
  status text not null default 'paid' check (status in ('pending','paid','settling','settled','cancelled')),
  movement_id uuid references public.movements(id) on delete set null,
  settlement_id uuid references public.settlements(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists importb2b_sale_payments_sale_idx on public.importb2b_sale_payments(sale_id);

create table if not exists public.importb2b_import_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  status text not null default 'uploaded' check (status in ('uploaded','analyzed','ready','imported','cancelled','failed')),
  products_filename text,
  customers_filename text,
  sales_filename text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.importb2b_import_rows (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null references public.importb2b_import_batches(id) on delete cascade,
  entity_type text not null check (entity_type in ('product','customer','sale')),
  row_number integer not null,
  source_id text,
  raw_data jsonb not null,
  normalized_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','ready','needs_review','imported','skipped','error')),
  issues text[] not null default '{}',
  target_id uuid,
  created_at timestamptz not null default now(),
  unique(batch_id, entity_type, row_number)
);
create index if not exists importb2b_import_rows_batch_idx on public.importb2b_import_rows(batch_id, entity_type, status);

-- Nullable bridges into the existing purchase/order app. Existing behavior remains unchanged.
alter table public.importb2b_order_items add column if not exists product_id uuid references public.importb2b_products(id) on delete set null;
alter table public.importb2b_order_items add column if not exists variant_id uuid references public.importb2b_product_variants(id) on delete set null;
alter table public.importb2b_order_items add column if not exists received_quantity numeric(14,3) not null default 0;
alter table public.importb2b_order_items add column if not exists stock_link_status text not null default 'unlinked';
create index if not exists importb2b_order_items_variant_idx on public.importb2b_order_items(variant_id);

-- Maintain a search document without forcing the UI to remember exact names.
create or replace function public.importb2b_products_prepare_search()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.search_text := lower(concat_ws(' ', coalesce(new.sku,''), coalesce(new.name,''), coalesce(new.category,''), coalesce(new.description,'')));
  return new;
end;
$$;
drop trigger if exists importb2b_products_prepare_search_trg on public.importb2b_products;
create trigger importb2b_products_prepare_search_trg
before insert or update of sku,name,category,description on public.importb2b_products
for each row execute function public.importb2b_products_prepare_search();

-- Updated-at triggers.
do $$
declare t text;
begin
  foreach t in array array[
    'importb2b_products','importb2b_product_images','importb2b_product_variants','importb2b_customers',
    'importb2b_sales','importb2b_payment_methods','importb2b_import_batches'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at_trg', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.importb2b_set_updated_at()', t || '_updated_at_trg', t);
  end loop;
end $$;

-- RLS for all private operational tables.
do $$
declare t text;
begin
  foreach t in array array[
    'importb2b_products','importb2b_product_aliases','importb2b_product_images','importb2b_product_variants',
    'importb2b_inventory_movements','importb2b_customers','importb2b_sales','importb2b_sale_items',
    'importb2b_payment_methods','importb2b_sale_payments','importb2b_import_batches','importb2b_import_rows'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = owner_id)', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = owner_id)', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = owner_id)', t || '_delete_own', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

grant usage, select on sequence public.importb2b_import_rows_id_seq to authenticated;
grant select on public.importb2b_stock_summary to authenticated;

-- Seed configurable payment methods for the current IMPORTB2B owner if they exist.
insert into public.importb2b_payment_methods(owner_id, code, name, adjustment_kind, adjustment_direction, adjustment_value, creates_settlement, sort_order)
select p.id, x.code, x.name, x.adjustment_kind, x.adjustment_direction, x.adjustment_value, x.creates_settlement, x.sort_order
from public.profiles p
cross join (values
  ('cash','Efectivo','none','surcharge',0::numeric,false,10),
  ('transfer','Transferencia','none','surcharge',0::numeric,false,20),
  ('debit','Débito','percent','surcharge',12::numeric,true,30),
  ('credit','Crédito','percent','surcharge',25::numeric,true,40),
  ('pay_later','Cuenta corriente','none','surcharge',0::numeric,false,50),
  ('other','Otros','none','surcharge',0::numeric,false,60)
) as x(code,name,adjustment_kind,adjustment_direction,adjustment_value,creates_settlement,sort_order)
where p.id = '9503c97f-e84e-467c-b22e-14745e6f62d9'::uuid
on conflict (owner_id, code) do nothing;
