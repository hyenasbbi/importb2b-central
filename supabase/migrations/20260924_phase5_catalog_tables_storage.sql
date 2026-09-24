-- IMPORTB2B Central · Fase 5
-- Catálogo público, pedidos web, reservas y Storage de imágenes.
-- Esta migración ya fue aplicada al Supabase principal durante el desarrollo de la Fase 5.

create table if not exists public.importb2b_catalog_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  public_slug text not null unique,
  is_public boolean not null default true,
  catalog_title text not null default 'IMPORTB2B',
  catalog_subtitle text,
  whatsapp_number text,
  show_exact_stock boolean not null default false,
  show_out_of_stock boolean not null default true,
  allow_pickup boolean not null default true,
  allow_shipping boolean not null default true,
  pickup_label text not null default 'Retiro',
  shipping_label text not null default 'Envío',
  shipping_note text,
  shipping_fee_ars numeric(14,2) not null default 0 check (shipping_fee_ars >= 0),
  min_order_ars numeric(14,2) not null default 0 check (min_order_ars >= 0),
  allow_pay_later_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.importb2b_catalog_settings enable row level security;
drop policy if exists importb2b_catalog_settings_select_own on public.importb2b_catalog_settings;
drop policy if exists importb2b_catalog_settings_insert_own on public.importb2b_catalog_settings;
drop policy if exists importb2b_catalog_settings_update_own on public.importb2b_catalog_settings;
create policy importb2b_catalog_settings_select_own on public.importb2b_catalog_settings for select to authenticated using ((select auth.uid())=owner_id);
create policy importb2b_catalog_settings_insert_own on public.importb2b_catalog_settings for insert to authenticated with check ((select auth.uid())=owner_id);
create policy importb2b_catalog_settings_update_own on public.importb2b_catalog_settings for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
grant select,insert,update on public.importb2b_catalog_settings to authenticated;

insert into public.importb2b_catalog_settings(owner_id,public_slug,catalog_title,catalog_subtitle)
select distinct owner_id,'importb2b','IMPORTB2B','Catálogo online'
from public.importb2b_products where owner_id is not null
on conflict (owner_id) do nothing;

create sequence if not exists public.importb2b_web_order_number_seq start 1;

create table if not exists public.importb2b_web_orders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_code text not null,
  status text not null default 'pending' check(status in ('pending','confirmed','cancelled','completed')),
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  delivery_type text not null check(delivery_type in ('pickup','shipping')),
  delivery_address text,
  notes text,
  payment_method_id uuid not null references public.importb2b_payment_methods(id) on delete restrict,
  subtotal_ars numeric(14,2) not null default 0,
  shipping_ars numeric(14,2) not null default 0,
  adjustment_ars numeric(14,2) not null default 0,
  total_ars numeric(14,2) not null default 0,
  sale_id uuid references public.importb2b_sales(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,order_code)
);

create table if not exists public.importb2b_web_order_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.importb2b_web_orders(id) on delete cascade,
  product_id uuid not null references public.importb2b_products(id) on delete restrict,
  variant_id uuid not null references public.importb2b_product_variants(id) on delete restrict,
  product_name text not null,
  variant_name text not null,
  quantity numeric(14,3) not null check(quantity > 0),
  unit_price_ars numeric(14,2) not null check(unit_price_ars >= 0),
  line_total_ars numeric(14,2) not null check(line_total_ars >= 0),
  created_at timestamptz not null default now()
);

alter table public.importb2b_web_orders enable row level security;
alter table public.importb2b_web_order_items enable row level security;
create policy importb2b_web_orders_select_own on public.importb2b_web_orders for select to authenticated using ((select auth.uid())=owner_id);
create policy importb2b_web_orders_update_own on public.importb2b_web_orders for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy importb2b_web_order_items_select_own on public.importb2b_web_order_items for select to authenticated using ((select auth.uid())=owner_id);
grant select,update on public.importb2b_web_orders to authenticated;
grant select on public.importb2b_web_order_items to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('importb2b-catalog','importb2b-catalog',true,10485760,array['image/jpeg','image/png','image/webp','image/avif']::text[])
on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy importb2b_catalog_storage_insert_own on storage.objects for insert to authenticated
with check(bucket_id='importb2b-catalog' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy importb2b_catalog_storage_update_own on storage.objects for update to authenticated
using(bucket_id='importb2b-catalog' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check(bucket_id='importb2b-catalog' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy importb2b_catalog_storage_delete_own on storage.objects for delete to authenticated
using(bucket_id='importb2b-catalog' and (storage.foldername(name))[1]=(select auth.uid())::text);
