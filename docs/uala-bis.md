# Ualá Bis Tienda Online — preparación, cobros deshabilitados

Revisión oficial: 26 de octubre de 2026. Esta entrega **no habilita cobros**.

Actualización de credenciales: el comercio proporcionó los valores originales en texto después del primer intento desde imagen. La autenticación oficial v2 de producción fue exitosa, sin crear órdenes ni imprimir el token. Se guardaron `UALA_USERNAME`, `UALA_CLIENT_ID`, `UALA_CLIENT_SECRET_ID` y `UALA_ENVIRONMENT` en Netlify / tiendaimport, marcadas como Secret values, exclusivamente en el contexto Production. Se verificó su presencia con los valores ocultos. Los secretos no están en Git. Esta actualización reemplaza el bloqueo de autenticación y la carga pendiente descritos en el historial del punto 2; los restantes requisitos de habilitación siguen pendientes.

## Cuotas confirmadas por el comercio — 26/10/2026

El comercio informa que Ualá confirmó la configuración de planes desde su app y que dejó habilitadas solamente 3 cuotas con financiación del 10% + IVA y 6 cuotas con financiación del 18% + IVA, para todas las tarjetas compatibles (sin exclusividad Naranja). Las 9 cuotas no están activas. Procesamiento 4,9% + IVA e IVA configurable 21% se mantienen separados de la financiación, según la fórmula solicitada.

Se actualizó la configuración existente de Supabase a 1000/1800 puntos básicos. El campo `financing_6_naranja_bps` conserva su nombre histórico para no romper las cotizaciones preparadas; el panel lo identifica como 6 cuotas para tarjetas compatibles. El valor histórico de 9 cuotas queda almacenado sin ofrecerse al comprador ni mostrarse como plan activo. No se habilitó ningún contrato técnico ni cobro con esta actualización.

La activación comercial desde la app reemplaza la solicitud anterior de confirmar disponibilidad. Falta validar en pruebas cómo conocer el plan efectivo elegido en el checkout alojado y su comisión, para mantener el neto al permitir más de un plan. No se deben inventar parámetros de selección en la API.

## Implementado

- Configuración administrativa de IVA (21%), procesamiento (4,9%), financiación 3 cuotas (10%) y 6 cuotas para tarjetas compatibles (18%). Son las tasas informadas por el comercio tras su confirmación con Ualá; no se efectuó un cobro para verificar liquidación.
- RPC `importb2b_uala_quote_order(order_id, plan)` para administradores: obtiene productos y envío del pedido en servidor, excluye ajustes de efectivo/transferencia y registra una estimación con tasas, IVA de ambos conceptos, comisiones y neto. No cambia el pedido ni su medio de pago. Los snapshots son estimaciones administrativas, nunca autorizaciones de cobro.
- Fórmula exacta con redondeo hacia arriba a pesos enteros. Comisiones e IVA de cada concepto redondeados conservadoramente a centavos; aumenta un peso adicional si hace falta para garantizar el neto **estimado**. No incluye retenciones/impuestos distintos de los configurados ni garantiza liquidación real del proveedor.
- Adaptador servidor v2 para token, creación de órdenes, consulta y devolución total, probado con transporte falso. Nunca usa mPOS, QR ni el producto comercial Link de Pago. La API Tienda Online sí devuelve `links.checkout_link`: es la URL del formulario alojado oficial, no una integración con Link de Pago.
- Validador de respuesta consultada en servidor: compara UUID, referencia e importe y permite solo estados conocidos; descarta datos de cliente/tarjeta. No hay captura de tarjetas en la tienda.
- Endpoint `/.netlify/functions/uala-checkout` bloqueado con HTTP 503. Ninguna variable de entorno lo habilita. Ningún plan se publica al comprador.

## Verificado en documentación oficial

| Tema | Contrato / evidencia |
|---|---|
| Versión | [v2 activa y recomendada](https://developers.ualabis.com.ar/v2) |
| Credenciales | [Test/producción](https://developers.ualabis.com.ar/v2/ambientes): username, client_id, client_secret_id de la cuenta del comercio |
| Auth | [POST /auth/token](https://developers.ualabis.com.ar/v2/authentication/create), client_credentials; access_token 86400 s |
| Orden | [POST /checkout](https://developers.ualabis.com.ar/v2/orders/create), amount string entero en centavos; tabla: $25 a $9.999.999. Los ejemplos decimales y el texto de algunos errores contradicen esa tabla: verificar en sandbox antes de producción |
| Tarjetas/cuotas | [Formulario oficial](https://developers.ualabis.com.ar/): el formulario muestra planes después de ingresar la tarjeta. POST /checkout no documenta installments, BIN, emisor, filtro de planes ni endpoint de compatibilidad. No se puede prometer/fijar 3/6 Naranja/9 desde esta API pública |
| Webhook | [POST notification_url](https://developers.ualabis.com.ar/v2/orders/create/webhook): UUID, external_reference, status. No se documenta firma. Nunca confiar en este cuerpo; usarlo solo como disparador de GET autenticado |
| Estados | [GET /orders/{uuid}](https://developers.ualabis.com.ar/v2/orders/get): PENDING, PROCESSED (pendiente desembolso), REJECTED, APPROVED, REFUNDED. Hay erratas PROCCESED en ejemplos: no tratarlas como aprobado |
| Devolución | [POST /orders/{uuid}/refund](https://developers.ualabis.com.ar/v2/refunds/create), total, aprobada, sin devolución en curso, menos de 90 días. Solicitud no equivale a devolución confirmada |
| Webhook refund | [REFUNDED / NOT_REFUNDED](https://developers.ualabis.com.ar/v2/refunds/create/webhook); tampoco se documenta firma. Confirmar mediante consulta autenticada, no por el cuerpo recibido |
| Cancelación | La referencia pública v2 revisada no ofrece endpoint de cancelación de orden pendiente. Cancelar localmente no impide un pago tardío |

## Lo que falta para habilitar

1. La disponibilidad comercial de 3/6 cuotas ya fue confirmada por el comercio y configurada desde la app. Validar técnicamente el plan efectivo, las tarjetas compatibles y las comisiones de la operación antes de liquidar: el importe calculado para 3 cuotas no garantiza el neto si el comprador elige 6 en el formulario remoto. No activar 9 cuotas.
2. Configurar credenciales sandbox y producción solo en secretos del backend Netlify: `UALA_USERNAME`, `UALA_CLIENT_ID`, `UALA_CLIENT_SECRET_ID`, ambiente explícito. No cargarlas en HTML, JS público, SQL ni Git. Se recibieron capturas privadas del correo de alta; una única prueba de autenticación v2 con la lectura de la imagen devolvió HTTP 401, sin crear órdenes ni imprimir tokens. No demuestra que la credencial original sea inválida: puede existir error de lectura. No se guardaron esos valores en Netlify ni en el repositorio. Sitio identificado: `tiendaimport`, dominio `importb2b.shop`. Quedó preparado el formulario de Netlify para cargar valores originales como secretos solo del contexto Production, sin importarlos. El correo usa URLs v1 y una tarjeta de prueba con vencimiento 03/25: obtener datos de prueba vigentes desde el portal. La [guía oficial de migración](https://developers.ualabis.com.ar/v2/migracion) indica que las credenciales se conservan en v2, cambiando URLs y `user_name` a `username`. Esta entrega no incluye un despliegue Netlify.
3. Prueba real sandbox del contrato de importe (tabla en centavos vs ejemplos contradictorios), órdenes, tarjetas de prueba de la cuenta, consultas y refunds.
4. Implementar checkout completo después de resolver el contrato: recalcular carrito desde stock/precios vigentes dentro de transacción, reservar antes de pedir cobro, snapshot inmutable, clave única por intento/pedido y registro duradero **antes** del POST. Timeout ambiguo debe bloquear reintento y reconciliar, nunca repetir el cobro automáticamente; `external_reference` no está documentado como clave idempotente.
5. Implementar receptor webhook y reconciliación autenticada periódica; comparar UUID, referencia, importe, plan efectivo y moneda implícita ARS. Proteger endpoint de abuso, registrar solo campos permitidos, soportar duplicados/eventos fuera de orden. PROCESSED no liquida. Callback del navegador solo informa estado pendiente.
6. Liquidación atómica con bloqueo del pedido: una venta/Caja por pago, referencia única de proveedor, monto bruto y comisión separados; stock reservado se consume una sola vez. El RPC actual de confirmación recalcula ajustes del medio de pago: no reutilizarlo sin adaptar el neto de Ualá. No usar retornos del navegador para marcar pagado.
7. Cancelaciones/refunds con idempotencia local: mantener conciliación de pagos tardíos, no liberar una reserva mientras el proveedor pueda cobrar sin un flujo de excepción/reembolso definido. Confirmar refund en servidor antes de revertir Caja; reposición de stock requiere validar entrega/devolución física.
8. Solo entonces habilitar en backend planes confirmados y compatibles, agregar la opción al checkout y validar regresión visual/funcional. Efectivo y transferencia siguen independientes.

## Validación

`node --test tests/uala.mjs` prueba importes, IVA configurable, redondeos, referencias/importes falsos, estados, auth/órdenes mock, errores sin secretos y bloqueo del endpoint. No son cobros de prueba reales ni certificación Ualá. La migración es aditiva: no cambia productos, precios, existencias, métodos existentes, pedidos, ventas ni Caja.

Verificación ejecutada en `jgjvzqfxakvogaeqfual`: cálculo SQL en 84 combinaciones de neto/plan/IVA con neto preservado; defaults correctos; RLS activo en ambas tablas; sin permisos anónimos sobre configuración, inserción de cotizaciones ni RPC de pedidos; usuario no administrador ve cero filas. El RPC sobre un pedido real devolvió `estimate_only=true` dentro de una transacción revertida (cero cotizaciones de prueba persistidas). Advisors no reportó hallazgos en los objetos Ualá; existen avisos previos ajenos a esta integración. También pasaron las regresiones existentes de checkout WhatsApp y PDF por talle.
