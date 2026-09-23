# IMPORTB2B Central — Fase 4

## Estado
Backend Fase 4 ya aplicado en Supabase `jgjvzqfxakvogaeqfual`.

## Incluye
- POS / Vender responsive.
- Búsqueda por producto, SKU, categoría y variante/sabor.
- Carrito con cantidad y precio editable.
- Cliente opcional; cuenta corriente exige cliente.
- 161 clientes de Kyte migrados a la base maestra.
- Efectivo / Transferencia -> ingreso automático en Control Financiero.
- Débito / Crédito -> dinero a liquidar.
- Cuenta corriente -> cuenta por cobrar.
- Recargos reales de forma de pago aplicados al total.
- Venta completada -> descuenta stock por movimiento auditable.
- Anulación -> devuelve stock y revierte/cancela efecto financiero.
- Recibo imprimible.
- Dashboard con ventas de hoy y facturación mensual.
- Finanzas muestra movimientos, dinero a liquidar y cuentas por cobrar.

## Seguridad
El frontend usa solamente la publishable key. Las operaciones sensibles de venta/cancelación se ejecutan en funciones PostgreSQL transaccionales con RLS / auth.uid().
