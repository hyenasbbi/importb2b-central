# IMPORTB2B Central — Fase 1

Base unificada para Productos, Stock, Ventas, Pedidos, Finanzas, Clientes, Catálogo, PDF y Club.

## Estado de esta fase

- Supabase principal conectado.
- Esquema central creado de forma aditiva.
- Pedidos actuales preservados y preparados para vincular productos/variantes.
- Control Financiero leído directamente desde `movements`, `receivables` y `settlements`.
- Buscador de productos preparado con `pg_trgm`.
- Importador Kyte en modo **staging**: sube CSV, normaliza y marca problemas sin modificar todavía el stock definitivo.
- Formas de pago configurables; Débito +12% y Crédito +25% quedan como reglas reales, no solo texto.

## Despliegue

Es una SPA estática. Se puede desplegar directamente en Netlify apuntando a la raíz del repositorio.

No se debe agregar ninguna `service_role` key al frontend. `assets/js/config.js` usa únicamente la publishable key.

## Uso inicial

1. Iniciar sesión con un usuario que ya exista en el Supabase actual.
2. Ir a **Importar Kyte**.
3. Cargar `Products`, `Customers` y `Sales` exportados por Kyte.
4. La app crea un lote de importación y guarda las filas en staging.
5. Revisar los problemas detectados antes de consolidar el stock definitivo.

## Próxima fase

- Pantalla de revisión del lote Kyte y consolidación a Productos/Variantes.
- Recepción de mercadería Pedido → Stock.
- POS Venta → Stock → Movimiento financiero / Cuenta por cobrar.
- Catálogo público automático.
- Generador PDF leyendo la misma base.
- Integración con Club IMPORTB2B.
