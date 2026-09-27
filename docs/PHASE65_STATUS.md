# IMPORTB2B Central — Fase 6.5

## Administración de clientes
- La ficha de cliente incorpora una zona de administración con **Unificar**, **Archivar** y **Eliminar**.
- La unificación mueve ventas, cuentas por cobrar y la información del Club a la ficha elegida, conserva premios entregados y deja la ficha origen inactiva para trazabilidad.
- El borrado físico solo se permite cuando la ficha no tiene ventas, cuentas por cobrar ni membresías de Club.

## Club
- Cada membresía permite **Ajustar puntos** manualmente.
- El ajuste exige un motivo, genera evento histórico y auditoría.
- Si se bajan puntos, los premios pendientes que ya no correspondan se vuelven a bloquear; los premios ya entregados se conservan.

## Compras / Mercadería
- Nuevo flujo de pedido basado en la antigua app de IMPORTB2B:
  1. fecha, cotización USDT, envío, moneda, proveedor y nota;
  2. carga de productos existentes o nuevos;
  3. resumen de unidades, mercadería, envío y costo puesto;
  4. finalizar pedido sin sumar stock físico.
- El envío se distribuye entre todas las unidades del pedido.
- Un producto existente se vincula por variante; un producto nuevo puede crearse desde el pedido.
- Coincidencias de nombre se señalan antes de crear para reducir duplicados.
- La recepción total o parcial es la acción que realmente aumenta `on_hand`.
- Los pedidos históricos mantienen `Histórico · stock incluido` y no vuelven a ingresar unidades.

## Vía Cargo + 17TRACK
- Seguimiento vinculado a una compra mediante número de guía.
- Registro y refresh usan las Edge Functions existentes `seventeen-track-register` y `seventeen-track-refresh`.
- Estados: Sin novedades, Ingresado, En viaje, Centro de distribución, Para retirar y Retirado.
- **Marcar retirado** no suma stock. Luego debe registrarse la recepción de mercadería.
- El estado del pedido se sincroniza automáticamente con el tracking.

## Gastos
- Registro de Materia prima, Envío, Impuesto, Logística, Proveedor, Servicio, Comisión, Publicidad u Otro.
- Un gasto puede vincularse a una compra.
- Opcionalmente puede impactar en Finanzas indicando Efectivo/Transferencia y Nahuel/Esteban.

## Mayorista
- Nueva sección **Mayorista**.
- Márgenes por categoría para Minorista, Mayorista 6+, 12+ y 36+.
- Precios sugeridos a partir del costo actual y redondeo a $500.
- Cada variante admite un precio manual por escalón.

## PDF Mayorista
- El generador conserva la selección manual de productos.
- Selector de precio: Mayorista 6+, 12+ o 36+.
- Toma fotos, variantes, stock y precios directamente de Central.
- Usa el logo IMPORTB2B transparente también en la versión mayorista.

## Base de datos
Las migraciones de Fase 6.5 ya fueron aplicadas al proyecto Supabase de producción. Los SQL incluidos en `supabase/migrations/` se conservan para reproducibilidad.
