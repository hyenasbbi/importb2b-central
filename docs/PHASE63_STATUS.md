# IMPORTB2B Central — Fase 6.3

## Mobile UX
- Sidebar off-canvas tipo Kyte.
- Header compacto.
- Categorías del POS en scroll horizontal.
- Vista productos lista / cuadrícula persistente por dispositivo.
- Variantes en bottom sheet en móvil.

## Ventas
- Titular Nahuel / Esteban obligatorio para movimientos inmediatos de caja.
- Venta fugaz con alerta de stock pendiente.
- Vinculación posterior de la venta fugaz a una variante real.
- Anulación reversible: stock + finanzas, sin borrar el historial.

## Finanzas
- Saldos explicados por medio y titular.
- Transferencia / Efectivo / USDT → Nahuel / Esteban / Sin asignar.
- Asignación de movimientos históricos sin duplicar caja.

## Fotos y catálogo
- Drag & drop múltiple en PC.
- Carga múltiple en móvil.
- Optimización WebP + thumbnail previa a Storage.
- Catálogo público usa thumbnail y lazy loading.

## Migración
`supabase/migrations/20260926_phase63_mobile_finance_media.sql`

## Estado DB
Aplicado al Supabase principal el 26/09/2026 en tres migraciones equivalentes al SQL acumulativo incluido en este paquete:
- importb2b_phase63_core_holder_sale
- importb2b_phase63_quick_sale_cancel
- importb2b_phase63_weborder_catalog_thumb
