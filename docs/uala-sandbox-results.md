# Ualá: resultados del ensayo real en TEST

26 de octubre de 2026. El comercio autorizó una única simulación de pago con tarjeta ficticia vigente. No hubo dinero real ni cambios de stock, pedidos, ventas o Caja en IMPORTB2B.

## Verificado

- Autenticación v2 TEST exitosa con credenciales separadas de producción.
- Creación de dos órdenes de ensayo para contrastar el formato de importe. Solo se pagó la segunda, con autorización explícita. Nunca repetir su POST.
- La segunda orden se confirmó mediante GET autenticado en servidor: status APPROVED y external_reference coincidente. El retorno del navegador no se utilizó como confirmación.
- Base de la orden: ARS62. En el formulario se seleccionó el plan rotulado 3 cuotas de la cuenta genérica de homologación; total financiado mostrado ARS66,34.
- Comisiones reportadas: UALÁ ARS3,04 (4,9%) e IVA ARS0,64 (21% de la comisión). Retenciones reportadas en cero. Son importes de prueba, sin desembolso real certificado.

## Diferencias que bloquean una activación automática

1. La documentación v2 declara amount como centavos enteros, pero TEST mostró ARS6.200 al enviar "6200". Enviar "62.00" devolvió amount=62 y mostró ARS62. La primera orden no se pagó. Mantener centavos exactos internamente; validar y configurar explícitamente el contrato por ambiente antes de crear cobros.
2. Al seleccionar 3 cuotas en la interfaz, GET devolvió installments.number=13, total=66.34, financial_cost=4.340000000000003 y value_per_installment=5.1. No inferir que 13 equivale universalmente a 3 ni interpretar ese campo como cantidad sin confirmar el contrato. El backend actual manda a revisión ese valor en vez de registrar Caja.
3. La cuenta genérica TEST ofreció 1 cuota sin interés y planes 3/6/12 con CF5,41%/10,31%/19%, diferentes de los planes comerciales confirmados para producción: 3/10%, 6/18%, 9/25,70%, financiación más IVA. No copiar las tasas genéricas a producción. El formulario sumó financiación al importe de la orden: evitar agregarla dos veces entre la tienda y el proveedor.
4. El formulario TEST devuelto por la API autenticada está en stage-uala-arg-bis-link-de-pago-web.vercel.app y redirige al procesador alojado de Ualá. El validador preparado permite solo uala-checkout.com; cualquier ajuste debe restringir host exacto y ambiente, sin habilitar un dominio genérico de hosting.
5. GET de la orden aún no pagada respondió 404; después de completar la misma orden respondió APPROVED. Un 404 previo al pago no autoriza repetir POST, cancelar ni liberar stock automáticamente.

Este ensayo aislado omitió notification_url. No certifica webhook, reserva/stock contra el proveedor ni devolución. El backend transaccional y los webhooks tienen pruebas separadas con transporte simulado y SQL revertido. Hace falta validar el circuito completo con las diferencias resueltas antes de habilitar cobros.

## Regresiones incorporadas

La respuesta amount=62 se rechaza frente a una expectativa de 6200 centavos sin conversión validada. El código 13 no puede aprobar automáticamente un intento de 3 cuotas. Se mantiene el endpoint público bloqueado y la conciliación programada dormida. No se guardan número de tarjeta, CVV, tokens, claves ni respuestas de cliente en estos archivos.
