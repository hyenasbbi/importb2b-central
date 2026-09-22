# Fase 2 — Estado

Fecha: 2026-09-22

## Backend ya aplicado en Supabase

Proyecto: `jgjvzqfxakvogaeqfual`

Se agregó:
- vista `importb2b_import_batch_stats`
- RPC `importb2b_refresh_kyte_product_issues`
- RPC `importb2b_merge_kyte_product_rows`
- RPC `importb2b_commit_kyte_products`
- `updated_at` para staging de importación

El lote principal existente quedó analizado con:
- 329 filas de productos
- 311 listas para consolidar
- 18 para revisar

Las 18 incluyen faltantes de categoría, stock negativo y duplicados canónicos detectados.

## Reglas

- Stock 0: crea/conserva variante, no genera unidades.
- Stock positivo: genera un único movimiento `kyte_import`.
- Stock negativo: no se consolida hasta revisión.
- Duplicados: se pueden fusionar; suma stock y conserva costo/precio de la fila elegida.
- La edición posterior de stock crea movimientos `adjustment`; no pisa el saldo silenciosamente.
