# Ualá Bis: circuito transaccional preparado, activación pendiente

26 de octubre de 2026. **Cobros no habilitados.** El endpoint público continúa bloqueado por `READINESS.enabled=false`; los contratos oficiales habilitados en la base son cero. Ninguna variable de entorno lo activa.

## Trabajo realizado

La migración `uala_payment_lifecycle` agrega un registro duradero por pedido, con UUID de idempotencia, referencia externa, ambiente, plan, tasas/comisión/IVA/neto estimados, UUID remoto único, estado verificado y referencias únicas de venta/Caja. Administradores pueden leer; solo `service_role` puede ejecutar operaciones de pago. Ambas tablas tienen RLS. Las versiones de archivos de migración se alinearon con las versiones efectivamente registradas en Supabase.

`importb2b_uala_prepare` bloquea el pedido y las variantes, verifica precios vigentes y pertenencia, conserva/reserva stock y crea el intento antes del POST remoto. Solo acepta pedidos propios del medio `uala_bis_online` y planes con contrato oficialmente respaldado; esta entrega no crea ese medio ni habilita contratos. Una segunda llamada retorna el intento existente. Cambios de plan/ambiente se rechazan. No existe un segundo POST automático, tampoco ante un timeout o una respuesta que no pudo persistirse: queda `unknown` para revisión.

`uala-webhook` recibe una notificación como disparador sin confiar en su estado. Solo consulta UUIDs previamente vinculados. Consulta la API v2 autenticada y compara UUID, referencia, importe, ambiente y luego cuotas/emisor. No guarda respuesta cruda, PAN, nombre de titular ni datos de tarjeta. Los cuerpos inválidos se rechazan; fallos de consulta devuelven 503 para solicitar reintento. Las notificaciones desconocidas tienen una respuesta genérica. No existe firma pública documentada que podamos simular.

`uala-reconcile` está preparado como función programada de Netlify cada 15 minutos, con máximo dos consultas concurrentes para su límite de ejecución. La configuración `schedule` impide invocaciones directas por URL según la documentación oficial. Solo concilia estados; no crea cobros. `unknown` sin UUID remoto requiere revisión manual, porque la documentación no garantiza idempotencia del POST ni consulta por referencia externa.

`importb2b_uala_apply_verified` es exclusivamente de servidor. Un plan/emisor incorrecto pasa a revisión; eventos repetidos o atrasados no deshacen un pago ya registrado. `PROCESSED` sigue pendiente de desembolso. `APPROVED` por sí solo no crea un movimiento de Caja.

`importb2b_uala_post_to_caja` requiere aprobación verificada, ambiente de producción y **comisión real conciliada**, no una cifra enviada por comprador ni una estimación. Comprueba que el neto real cubra el neto deseado, crea una sola venta y un ingreso neto en Caja, conserva el bruto y las comisiones por separado, consume stock y libera la reserva dentro de una transacción. Repetir la operación devuelve las mismas referencias. Sandbox tiene prohibido registrar ventas/Caja.

Los pedidos/detalles con intentos Ualá quedan protegidos contra confirmación, edición o cancelación manual por las rutas de efectivo/transferencia. Cancelar localmente o recibir un rechazo no libera automáticamente una reserva mientras el formulario remoto pueda seguir cobrando. Un reembolso confirmado antes de registrar la venta puede liberar la reserva idempotentemente. Un reembolso posterior pasa a `refund_review`: no repone existencias físicas ni revierte Caja automáticamente con importes supuestos.

## Pruebas realizadas

- `node --test tests/uala.mjs tests/uala-lifecycle.mjs`: 13 pruebas aprobadas, incluyendo notificaciones falsas, UUID ajeno, referencias/importes/ambientes incorrectos, pérdida de persistencia y timeout, doble solicitud concurrente y URL de formulario no autorizada.
- `tests/uala-lifecycle.sql`, ejecutado en transacciones revertidas contra el esquema real, también bajo `service_role`: contratos cerrados por defecto, reserva, reclamo único, validación de importe/cuotas, eventos atrasados, un solo ingreso en Caja, consumo de stock una vez, aislamiento sandbox, reembolso/liberación repetida, permisos y bloqueo de confirmación/edición manual.
- Cero intentos, contratos habilitados o productos ficticios persistidos después de las pruebas. Sin nuevos hallazgos de seguridad de advisors sobre objetos Ualá.

Las pruebas usan transporte falso y fixtures SQL revertidos: **no son una prueba real de pago ni certificación del proveedor**. Esta etapa agrega el esquema a Supabase; el nuevo código de funciones debe revisarse/desplegarse antes de utilizarse.

## Bloqueos concretos para activar

1. **Contrato de financiación:** Ualá debe confirmar 3 cuotas, 6 Naranja promo y 9 cuotas, sus emisores y la forma técnica de restringir el plan antes del cobro. La API pública de creación solo documenta importe, descripción, URLs y referencia. La selección comercial del dueño no reemplaza esta confirmación. No se inventa un parámetro `installments`.
2. **Sandbox vigente:** faltan credenciales y tarjeta de prueba actuales del portal. El correo compartido muestra una tarjeta vencida. Probar creación, pago, notificaciones, consulta y devolución con datos vigentes; sin una prueba real sandbox no habilitar producción.
3. **Backend:** Netlify tiene las credenciales Ualá, pero se debe configurar y verificar también el acceso privado de servidor a Supabase (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`) exclusivamente como secreto de Functions. No usar una clave pública para las RPC de pagos ni revelar la clave privada en el sitio.
4. **Conectar el checkout y conciliación real:** integrar creación de pedido Ualá con el contrato oficial obtenido en el punto 1, autorización de acceso del comprador al intento, UI de planes compatibles y callbacks de estado. La selección de cuotas debe ser respetada por el proveedor antes del cobro, no solo detectada después. Conectar la comisión/crédito real a `post_to_caja` después de validar las unidades y campos en sandbox; el formato de `commissions` y `taxes` no se asume a partir de ejemplos incompletos.
5. **Refunds/cancelaciones:** implementar petición de devolución con reclamo duradero y seguimiento de respuestas ambiguas; definir conciliación de debitado real y revisión de stock físico después de una venta. La API pública no documenta cancelación de órdenes pendientes. No tratar el regreso del navegador como aprobación ni como cancelación remota.

## Fuentes oficiales

- [Crear orden v2](https://developers.ualabis.com.ar/v2/orders/create)
- [Consultar orden y estados](https://developers.ualabis.com.ar/v2/orders/get)
- [Webhook](https://developers.ualabis.com.ar/v2/orders/create/webhook)
- [Devoluciones](https://developers.ualabis.com.ar/v2/refunds/create)
- [Ambientes y tarjetas de prueba](https://developers.ualabis.com.ar/v2/ambientes)
- [Funciones programadas Netlify](https://docs.netlify.com/build/functions/scheduled-functions/)

La publicación inicial de configuración está en PR #2, fusionado y desplegado. En Netlify se agregó una excepción **solo para `UALA_ENVIRONMENT`** mediante `SECRETS_SCAN_OMIT_KEYS`, porque el texto no confidencial `production` había sido marcado como secreto. Las credenciales siguen protegidas; no se desactivó el escaneo general.
