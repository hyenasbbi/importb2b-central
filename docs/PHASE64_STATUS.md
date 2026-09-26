# IMPORTB2B Central — Fase 6.4

## Inicio → Finanzas
- Los últimos movimientos del Inicio ahora son clickeables.
- Al tocarlos, Central abre Finanzas → Movimientos, filtra el movimiento y expande el registro exacto cuando está disponible.

## Movimientos financieros
- Movimiento manual: Editar / Eliminar.
- Movimiento originado por una venta: Anular venta, no borrado destructivo.
- Una venta anulada conserva el movimiento original visible y tachado con estado CANCELADA.
- La anulación usa la reversión de stock y finanzas ya implementada en Fase 6.3.

## Carrito
- Cada producto se presenta en una tarjeta rectangular ordenada.
- Foto, nombre, variante/SKU, cantidad, precio unitario y total tienen jerarquía propia.
- Botón Eliminar visible por producto.
- Reflujo específico para pantallas angostas.

## Clientes / Club
- La columna Club está centrada.
- 1 club = 👑; 2 clubes = 👑👑; etc.
- Sin Club = —.
- No se muestran puntos ni texto adicional en esa columna.

## Vender / Lista
- Modo lista convertido en una grilla de columnas reales: Producto / Categoría / Variante / Precio / Stock.
- Encabezados alineados en escritorio.
- En tablet se simplifican columnas secundarias.
- En móvil pasa a una composición compacta sin forzar una tabla horizontal.
- Modo cuadrícula mantiene foto, nombre, precio y stock con alturas consistentes.

## Base de datos
- No requiere migraciones nuevas de Supabase.
- Reutiliza cancelación de ventas, eliminación segura de movimientos manuales y trazabilidad implementadas previamente.
