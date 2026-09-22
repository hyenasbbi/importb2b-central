# Mapa de integración — IMPORTB2B Central

## Supabase principal
Proyecto: `jgjvzqfxakvogaeqfual`

### Ya existente y preservado
- `importb2b_orders` / `importb2b_order_items`: compras y registro de pedidos.
- `importb2b_shipments` / `importb2b_tracking_events`: Vía Cargo + 17TRACK.
- `movements`: caja e ingresos/egresos.
- `settlements`: dinero a liquidar.
- `receivables` / `receivable_payments`: cuentas por cobrar.
- `internal_transfers` / `currency_conversions`: movimientos internos y ARS/USDT.

### Núcleo nuevo
- `importb2b_products`
- `importb2b_product_variants`
- `importb2b_product_images`
- `importb2b_product_aliases`
- `importb2b_inventory_movements`
- `importb2b_stock_summary`
- `importb2b_customers`
- `importb2b_sales`
- `importb2b_sale_items`
- `importb2b_payment_methods`
- `importb2b_sale_payments`
- `importb2b_import_batches` / `importb2b_import_rows`

## Puente con Pedidos
A `importb2b_order_items` se agregaron de forma nullable:
- `product_id`
- `variant_id`
- `received_quantity`
- `stock_link_status`

Esto permite que un pedido viejo siga igual y que uno nuevo pueda dar de alta stock al recibirse.

## Regla de stock
El stock se audita mediante movimientos. `stock = 0` conserva la variante pero no crea una entrada. El stock negativo se marca para revisión.

## Finanzas
Las ventas nuevas podrán crear un registro en `movements` y guardar el vínculo usando `source_type='sale'` + `source_id=<uuid venta>`.

## Club
`Clubimportb2b` hoy apunta a otro proyecto Supabase (`ltjaxjwyacrlcyfzpgkq`). No se migró ni se modificó en Fase 1. Se integrará una vez que ese proyecto esté disponible en la conexión de Supabase.
