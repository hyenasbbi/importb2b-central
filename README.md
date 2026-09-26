# IMPORTB2B Central — Fase 6.3

Versión acumulativa sobre Fase 6.2. Mantiene Cliente 360°, Club migrado, PDF selectivo y todos los módulos anteriores.

## Novedades 6.3
- Mobile con menú lateral desplegable tipo app, header compacto y navegación más limpia.
- Vender con categorías horizontales, vista cuadrícula/listado y selector de variantes en mini menú.
- Venta fugaz ⚡ para registrar el cobro en segundos y vincular el stock después.
- Toda venta inmediata por efectivo/transferencia pregunta quién recibe: Nahuel o Esteban.
- Confirmar pedidos web también registra el titular del dinero.
- Anular venta conserva el registro como CANCELADA, reintegra stock y revierte el efecto financiero.
- Finanzas: Transferencias / Efectivo / USDT muestran Nahuel, Esteban y Sin asignar.
- El dinero Sin asignar se puede asignar con un toque, sin duplicar movimientos.
- Carga de imágenes visible por drag & drop en PC y selector múltiple en móvil.
- Fotos nuevas optimizadas automáticamente a WebP + thumbnail antes de subir.
- Catálogo online usa miniaturas livianas con lazy loading.

## Imágenes
Las fotos nuevas se procesan en el navegador antes de subir:
- imagen principal: máximo aproximado 1700 px, WebP calidad 82%;
- miniatura: máximo aproximado 480 px, WebP calidad 72%;
- caché larga en Storage;
- las imágenes antiguas continúan funcionando con fallback a `image_url`.

## Base de datos
La migración `20260926_phase63_mobile_finance_media.sql` agrega los campos de miniaturas, estado de vinculación de stock y RPCs seguros para titulares, ventas fugaces, cancelaciones y confirmación de pedidos.
