# Estado Fase 1 — 22/09/2026

Aplicado en Supabase `jgjvzqfxakvogaeqfual`:

- Núcleo Productos / Variantes / Inventario / Clientes / Ventas.
- Tablas de staging para importación Kyte.
- RLS por usuario autenticado en todas las tablas nuevas.
- `pg_trgm` para búsquedas tolerantes y rápidas.
- Puentes `product_id`, `variant_id`, `received_quantity`, `stock_link_status` en `importb2b_order_items`.
- Métodos de pago iniciales: Efectivo 0%, Transferencia 0%, Débito +12%, Crédito +25%, Cuenta corriente, Otros.
- Índices de soporte para FKs principales nuevas.

No se borró ni reescribió información de las apps existentes.

Pendiente de Fase 2:

- Consolidar staging Kyte a la base final luego de una pantalla de revisión.
- Crear recepción de pedido → movimiento de stock.
- Crear POS venta → stock → `movements` / `receivables`.
- Catálogo público y fotos.
- Integrar Supabase del Club.
