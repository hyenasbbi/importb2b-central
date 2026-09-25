# IMPORTB2B Central — Fase 6.1

Incluye acumulativamente Fase 6 + migración del Club histórico + generador PDF conectado a Stock.

## Club histórico
- Importador de 6 CSV desde el navegador.
- Fusiona por teléfono, Instagram y nombre exacto.
- Conserva código IMP, token, membresías, puntos, acciones, premios e historial.
- Idempotente: puede ejecutarse nuevamente sin duplicar acciones/eventos.
- Los CSV nunca se guardan en GitHub.

## Cliente 360
- Resumen, compras, deudas, Club y datos.
- Historial del Club integrado.

## PDF / Catálogos
- Lee Stock Central directamente.
- Filtro por categoría y stock.
- Selección de productos.
- PDF Clientes con precio minorista y branding IMPORTB2B.
- PDF Revendedores con wholesale_price_ars cuando existe y sin branding IMPORTB2B.
- Fotos tomadas del catálogo/Storage.

La migración de esquema 6.1 ya fue aplicada al Supabase principal.
