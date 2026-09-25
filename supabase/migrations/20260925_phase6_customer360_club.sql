-- IMPORTB2B Central · Phase 6
-- Source mirror of the migration already applied to Supabase Central.
-- Cliente 360 + Club multi-membresía.

create sequence if not exists public.importb2b_club_member_seq start 1;

create table if not exists public.importb2b_club_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references public.importb2b_customers(id) on delete cascade,
  member_code text not null,
  access_token text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,customer_id), unique(member_code), unique(access_token)
);

create table if not exists public.importb2b_club_memberships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references public.importb2b_customers(id) on delete cascade,
  club_type text not null check (club_type in ('vapers','jerseys','perfumes','importb2b')),
  points integer not null default 0 check(points>=0),
  active boolean not null default true,
  joined_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,customer_id,club_type)
);

create table if not exists public.importb2b_club_reward_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  club_type text not null check (club_type in ('vapers','jerseys','perfumes','importb2b')),
  milestone integer not null check(milestone>0),
  reward_name text not null,
  reward_description text,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,club_type,milestone)
);

create table if not exists public.importb2b_club_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references public.importb2b_customers(id) on delete cascade,
  membership_id uuid not null references public.importb2b_club_memberships(id) on delete cascade,
  club_type text not null check (club_type in ('vapers','jerseys','perfumes','importb2b')),
  sale_id uuid references public.importb2b_sales(id) on delete set null,
  purchase_amount numeric(14,2),
  observation text,
  point_value integer not null default 1 check(point_value=1),
  story_verified boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists importb2b_club_action_sale_uidx
on public.importb2b_club_actions(owner_id,club_type,sale_id) where sale_id is not null;

create table if not exists public.importb2b_club_reward_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references public.importb2b_customers(id) on delete cascade,
  membership_id uuid not null references public.importb2b_club_memberships(id) on delete cascade,
  club_type text not null check (club_type in ('vapers','jerseys','perfumes','importb2b')),
  milestone integer not null check(milestone>0),
  reward_name text not null,
  status text not null default 'pending' check(status in ('pending','delivered')),
  notes text,
  unlocked_at timestamptz not null default now(),
  delivered_at timestamptz,
  delivered_by uuid references auth.users(id) on delete set null,
  unique(owner_id,customer_id,club_type,milestone)
);

-- RLS: all admin-side tables are owner-scoped.
do $$
declare t text;
begin
  foreach t in array array['importb2b_club_profiles','importb2b_club_memberships','importb2b_club_reward_rules','importb2b_club_actions','importb2b_club_reward_claims'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_select_own',t);
    execute format('drop policy if exists %I on public.%I',t||'_insert_own',t);
    execute format('drop policy if exists %I on public.%I',t||'_update_own',t);
    execute format('drop policy if exists %I on public.%I',t||'_delete_own',t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid())=owner_id)',t||'_select_own',t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid())=owner_id)',t||'_insert_own',t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id)',t||'_update_own',t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid())=owner_id)',t||'_delete_own',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  end loop;
end $$;

grant usage,select on sequence public.importb2b_club_member_seq to authenticated;

insert into public.importb2b_club_reward_rules(owner_id,club_type,milestone,reward_name,reward_description,display_order)
select p.id,x.club_type,x.milestone,x.reward_name,x.reward_description,x.display_order
from public.profiles p
cross join (values
  ('vapers',3,'Recompensa Vapers I','Premio desbloqueado en la compra válida número 3.',1),
  ('vapers',6,'Recompensa Vapers II','Premio desbloqueado en la compra válida número 6.',2),
  ('vapers',9,'Recompensa Vapers III','Premio desbloqueado en la compra válida número 9.',3),
  ('jerseys',4,'Camiseta versión hincha','Camiseta versión hincha de regalo.',1),
  ('jerseys',8,'Short versión jugador','Short versión jugador de regalo.',2),
  ('perfumes',3,'Perfume Tier C','Perfume categoría Tier C de regalo.',1),
  ('perfumes',6,'Perfume Tier B','Perfume categoría Tier B de regalo.',2),
  ('perfumes',10,'Perfume Tier A','Perfume categoría Tier A de regalo.',3),
  ('importb2b',3,'Cupón 25% OFF','Cupón 25% OFF en cualquier producto.',1),
  ('importb2b',5,'Artículo Stanley sorpresa','Artículo Stanley sorpresa.',2),
  ('importb2b',8,'Mystery Gift IMPORTB2B','Mystery Gift IMPORTB2B.',3)
) x(club_type,milestone,reward_name,reward_description,display_order)
on conflict(owner_id,club_type,milestone) do update set reward_name=excluded.reward_name,reward_description=excluded.reward_description,display_order=excluded.display_order,active=true,updated_at=now();

-- The complete applied migration also defines the following views/RPCs:
-- importb2b_customer_360
-- importb2b_club_overview
-- importb2b_club_ensure_profile(uuid)
-- importb2b_club_add_membership(uuid,text)
-- importb2b_club_register_verified_purchase(uuid,text,uuid,numeric,text)
-- importb2b_club_deliver_reward(uuid,text)
-- importb2b_public_club_card(text)
-- These are already live in Supabase Central under migration:
-- importb2b_phase6_customer360_club
