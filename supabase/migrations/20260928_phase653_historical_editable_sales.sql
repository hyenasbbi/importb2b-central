-- Phase 6.5.3 · ventas históricas editables
-- Aplicada en producción el 2026-09-28.
alter table public.importb2b_sales
  add column if not exists is_historical boolean not null default false,
  add column if not exists historical_editable boolean not null default false;

create index if not exists importb2b_sales_historical_idx
on public.importb2b_sales(owner_id,is_historical,sold_at desc);

-- La función importb2b_update_historical_sale se instaló en producción.
-- Regla funcional: solo ventas con is_historical=true + historical_editable=true.
-- Editar una histórica actualiza venta/items/estadísticas, pero NO crea movimientos financieros
-- ni movimientos de inventario. El CSV original queda preservado en source_payload.
