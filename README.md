# IMPORTB2B Central · Fase 5

## Incluye
- Todo lo construido hasta Fase 4.1.
- Fotos de producto en Supabase Storage.
- Foto principal editable desde Productos / Stock.
- Catálogo público responsive en `/catalogo`.
- Buscador y categorías públicas.
- Variantes por talle, color, sabor, modelo o número.
- Carrito público desplegable.
- Checkout con retiro/envío y formas de pago.
- Pedidos web que reservan stock.
- Panel interno `Catálogo / Web` para configuración y pedidos.
- Confirmación de pedido web → venta real → stock → cliente → finanzas.
- Cancelación de pedido → libera reserva.

## Netlify
El proyecto incluye `netlify.toml` y Functions.

En **Netlify > Site configuration > Environment variables** cargar:

- `SUPABASE_URL=https://jgjvzqfxakvogaeqfual.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=` la misma publishable key de `assets/js/config.js`
- `SUPABASE_SERVICE_ROLE_KEY=` la service role key del proyecto (solo en Netlify; nunca en el frontend ni GitHub)

Luego redeploy.

## URLs
- Admin: `/`
- Catálogo público: `/catalogo`

## Base de datos
La migración de tablas + Storage de Fase 5 fue aplicada durante el desarrollo y queda versionada en `supabase/migrations/20260924_phase5_catalog_tables_storage.sql`.
