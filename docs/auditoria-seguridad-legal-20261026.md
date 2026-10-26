# Auditoría IMPORTB2B — 26/10/2026

## Alcance y conclusión

Repositorio `hyenasbbi/importb2b-central`, base GitHub `b9402b2`; proyecto Supabase `jgjvzqfxakvogaeqfual`; web `importb2b.shop`. Revisión estática, metadatos de configuración, políticas/RPC, funciones desplegadas seleccionadas, HTTP público y pruebas sin crear pedidos ni borrar clientes. No es una certificación de cumplimiento ni un pentest exhaustivo. No se consultaron contenidos de fichas de clientes ni credenciales privadas.

Se preservaron los cambios de Ualá ya fusionados, el checkout por WhatsApp y los métodos actuales. Copia de trabajo aislada: no se incluyeron cambios locales ajenos de catálogo o finanzas. Las correcciones de acceso no modifican importes, ventas, saldos ni las reglas contra duplicados.

## Hallazgos y tratamiento

| Gravedad | Hallazgo comprobado | Tratamiento / estado |
|---|---|---|
| Alta | Las políticas de ocho tablas financieras admitían usuarios autenticados sin autorización de personal. El registro de usuarios está habilitado. | Aplicado en Supabase: políticas restrictivas AND para los dos administradores definidos en la migración de acceso compartido existente. Incluye movimientos, cuentas corrientes, pagos, liquidaciones, transferencias, conversiones, cotizaciones y auditoría. Prueba con identidad ajena denegada; ambos administradores conservan lectura. |
| Alta | RPC SECURITY DEFINER de recuento de Caja solo verificaba autenticación; elude RLS. | Aplicado: verificación explícita de los administradores existentes antes de leer o modificar Caja. Se conserva el resto del cuerpo, con aborto ante cambios concurrentes inesperados. |
| Media | RPC internas de recuento, edición histórica y registro push ejecutables por anon. | Revocado EXECUTE a PUBLIC/anon, conservado para authenticated y sus validaciones internas. Catálogo, pedidos y Club siguen públicos por diseño. |
| Media | Cualquier autenticado podía leer perfiles del personal. | Aplicada política restrictiva: cada usuario lee el suyo; los dos administradores conservan la lectura operativa. |
| Alta potencial | Envío push utilizaba destinos guardados sin validar el proveedor; un destino arbitrario podía provocar conexiones salientes. | Función `importb2b-send-push` desplegada v13: HTTPS, proveedor/puerto autorizados, sin credenciales URL; errores sanitizados. CHECK validado sobre todas las suscripciones protege también los emisores programados. No se eliminaron suscripciones. Se mantuvo `jmt17.google.com`, usado por un dispositivo existente y documentado en Chromium. |
| Media | `publish="."` publicaba archivos internos. Se comprobó HTTP 200 para package.json y un archivo de migración SQL. | Cambio preparado: build por lista permitida hacia dist, excluye SQL, funciones fuente, pruebas, documentos y env. La desaparición de esas rutas depende del despliegue frontend. |
| Alta legal | Faltaban privacidad y términos; identidad fiscal del vendedor no verificable. | Páginas agregadas y enlazadas; datos no conocidos quedan expresamente pendientes. El titular debe completarlos; la sola existencia de las páginas no resuelve esa omisión. |
| Alta legal | Checkout comprobado visualmente: débito con recargo 12%, crédito genérico con 25%. | Eliminado el recargo de débito de la configuración de esta tienda para pedidos nuevos; precios base y pedidos anteriores intactos. Crédito queda pendiente de confirmar si existe financiación real y de informar sus condiciones; si es en un pago debe tener precio único. |
| Media legal | Checkout sin información y aceptación explícita; datos reenviados por WhatsApp. | Casilla desmarcada de lectura de privacidad/aceptación de venta, se reinicia al abrir checkout; aviso previo del envío de datos a WhatsApp. No es consentimiento de marketing. |
| Media legal | Sin canal visible de derechos y arrepentimiento. | Páginas con enlace al WhatsApp ya publicado, sin cuenta ni checkbox; identidad por contacto previo, conservación justificada, plazos y AAIP. Arrepentimiento visible al primer acceso. Recepción/acuse y resolución requieren atención humana. |
| Media | Faltan cabeceras contra MIME sniffing y framing. | Configuración agregada; APIs no-store; referrer no-referrer para evitar filtración del enlace Club. CSP en Report-Only para evaluar compatibilidad antes de imponerla; no se presenta como CSP aplicada. Service worker limita navegación push al origen propio. |
| Media | Supabase avisa protección de contraseñas filtradas deshabilitada. | Pendiente activar en Auth, comprobar disponibilidad del plan, y habilitar MFA de administradores. No se cambiaron contraseñas ni configuración global de registro del proyecto compartido. |
| Alta potencial | jsPDF 2.5.1 del CDN tiene avisos del proveedor posteriores. | Pendiente actualización compatible con pruebas reales de exportación. npm audit de dependencias servidor NO incluye bibliotecas CDN. El código revisado usa texto y PNG/JPEG, no HTML/AcroForm/addJS; eso limita algunas rutas, pero no certifica ausencia de impacto. No se cambió una versión mayor sin verificar PDFs. |

## Datos personales e inventario

| Conjunto / tablas | Información y finalidad |
|---|---|
| `importb2b_customers`, vistas customer_summary/customer_360 | Nombre, teléfonos, email, documento, domicilios, Instagram, notas, origen e importación; atención, facturación y relación comercial. Las vistas agregan compras, gastos y saldos. |
| `importb2b_web_orders`, web_order_items | Contacto, entrega, notas, productos, importes y modalidad; gestionar pedidos. |
| `importb2b_sales`, sale_items, sale_payments; receivables/receivable_payments/settlements | Compras, pagos, deuda, nombres/contactos vinculados, notas y trazabilidad financiera. |
| Tablas `importb2b_club_*` | Membresías, puntos, premios, historia, códigos, token de acceso personal. El RPC público devuelve nombre e historial a quien tenga el enlace. |
| `profiles`, `auth.users`, sesiones | Identidad y email de personal, rol, credenciales gestionadas por Supabase Auth, sesiones. No se inspeccionaron hashes de contraseña. |
| `importb2b_push_subscriptions`, notifications y outbox | Destino y claves push, navegador, dueño, mensajes y metadatos operativos. Tratar las suscripciones como información confidencial. |
| import_batches/import_rows, source_payload, audit_log | Archivos importados, datos originales/normalizados, cambios y actores; pueden duplicar datos personales. Incluirlos en supresión y retención. |
| Compras, envíos, tracking_events | Proveedor, transportista, seguimiento, lugares, eventos y datos del proveedor logístico; pueden ser datos personales si identifican personas. |
| Ualá attempts/quotes/contracts | IDs de pedido/proveedor, estado, importe, tasas, emisor y cuotas verificados. La conciliación descarta PAN, titular y respuesta cruda del proveedor. Cobros públicos continúan bloqueados. |
| Alojamiento y comunicaciones | IP, user-agent y logs técnicos potenciales en Netlify/Supabase; mensajes de WhatsApp y respaldos fuera de la base. Retención y contratos no verificados. |

No se detectó que el checkout recoja PAN/CVV. La columna de configuración VAPID privada está en una tabla con RLS y sin políticas públicas, utilizada por servidores; no se leyó su valor. Las claves service_role, tokens de tracking y credenciales Ualá se obtienen del entorno en el código revisado. No se cambiaron valores privados ni se inventó su disponibilidad.

## Evaluación AAIP

La Ley 25.326 y la AAIP distinguen archivos privados destinados a dar informes del uso exclusivamente personal. La guía oficial incluye expresamente bases empresariales de clientes y proveedores cuando se comunican datos para facturación, tributos y otras finalidades. Por el flujo comercial observado hay fundamento fuerte para evaluar la inscripción del responsable y de las bases pertinentes: no corresponde presumir una excepción por ser tienda pequeña o B2B.

No se verificó inscripción vigente, identidad/CUIT del responsable, cesiones efectivas, estructura completa de bases ni documentación contractual. Por eso no se afirma que IMPORTB2B esté registrada ni se emite una conclusión categórica sobre cada base. Acción del titular: reunir esos datos, contrastar el registro/TAD y confirmar el alcance con AAIP o asesor jurídico; tramitar la inscripción que corresponda. No se inició ningún trámite en nombre del titular.

La región técnica informada por Supabase es `sa-east-1`. Revisar país de tratamiento, lista de países adecuados de AAIP, contrato de encargado, subencargados y garantías de transferencia internacional; también Netlify, WhatsApp y proveedores de pago. La región por sí sola no verifica el cumplimiento del art. 12.

## Consentimiento, derechos y conservación

No se condiciona login, supresión o arrepentimiento a consentir marketing. Para el pedido, los datos contractualmente necesarios pueden estar amparados por el art. 5.2 de la Ley 25.326: la casilla de lectura/venta no sustituye esa evaluación ni autoriza publicidad. No se añadió una autorización opcional sin una finalidad implementada. Tampoco se modificaron los formularios internos de carga de clientes por personal para fingir consentimiento del cliente.

La casilla es un control de interfaz; no se guarda una prueba de consentimiento en la base ni se modificó el contrato de la RPC existente. Si se añade marketing/Club optativo o se requiere prueba de aceptación de versión contractual, implementar un registro independiente con finalidad, versión, fecha y origen, validación del servidor y revocación. No afirmar que existe hoy.

Procedimiento manual requerido: registrar fecha y derecho pedido, verificar identidad con el contacto previo sin pedir DNI de entrada, responder acceso dentro de diez días corridos y corrección/supresión dentro de cinco días hábiles conforme a ley, separar información eliminable de documentación obligatoria, informar los motivos y alcance de conservación y documentar la respuesta. No borrar ventas/comprobantes o cuentas admin en cascada. Revisar copias, exportaciones, logs, WhatsApp e importaciones; bloquear usos incompatibles y purgar al vencer los plazos. El art. 328 CCyC prevé diez años para documentación contable; no justifica guardar todos los datos del cliente por diez años. El contador debe determinar plazos fiscales concretos y excepciones.

Arrepentimiento: acuse con código dentro de 24 horas por el mismo medio y gestión efectiva, sin registración previa; la verificación razonable de identidad prevista en Disp. 3/2026 no habilita obstáculos. El enlace WhatsApp no acredita que un agente haya recibido/respondido. Hace falta asignar responsable y canal alternativo accesible. No se automatizó envío a terceros ni se enviaron mensajes de prueba.

## Secretos, OWASP y límites

- Escaneo de patrones de alta confianza: archivos Git actuales, 973 objetos históricos alcanzables y 13 páginas/scripts propios públicos. Sin coincidencias de claves privadas, tokens GitHub/AWS o JWT service_role en ese alcance. No prueba ausencia de cualquier secreto de formato desconocido, ramas remotas no disponibles, artefactos borrados, logs o variables del hosting.
- La clave `sb_publishable_…` del cliente es pública por diseño: moverla a un entorno que luego se compila al navegador no la vuelve privada. La protección es RLS y autorización de RPC. No es motivo por sí solo para rotarla. Cualquier secreto privado descubierto en otra revisión debe revocarse/rotarse en origen, cambiarse en el servidor y revisarse su uso; borrarlo del último commit no revoca copias antiguas.
- Todas las tablas public revisadas tienen RLS; las 17 vistas consultadas usan `security_invoker=true`. Storage de catálogo público es intencional; no guardar ahí DNI, comprobantes ni documentos privados. Políticas de escritura de Storage limitan carpeta al usuario.
- Los avisos SECURITY DEFINER no se resuelven convirtiendo indiscriminadamente catálogo/pedidos a invoker: son APIs públicas deliberadas. Recuento autorizado; edición histórica limita dueño; push usa auth.uid; catálogo filtra lo público; Club exige token. Persisten avisos que requieren reevaluación por función.
- RPC de pedidos calcula precios en base a datos del servidor; no marca pagado el regreso del navegador. Endpoints Ualá permanecen cerrados para cobro; webhook consulta el proveedor y valida monto/referencia/ambiente; idempotencia cubierta por pruebas simuladas. No se procesó un cobro real.
- Riesgo pendiente: RPC pública de pedidos accesible directamente sin limitación de frecuencia visible, captcha o registro de abuso. La protección del hosting no cubre invocaciones directas a Supabase. Añadir control distribuido y validar impacto antes de revocar el acceso directo del checkout. No se hicieron pruebas de carga contra producción.
- Logs de cron/webhooks y tracking pueden conservar payloads o errores con datos. Se inspeccionaron código y mecanismos de autenticación de funciones seleccionadas; no se descargaron logs de clientes ni se aseguró equivalencia byte a byte de todas las funciones remotas con el repo.
- Registro público habilitado y perfiles nuevos toman `admin` como valor por defecto. Los accesos críticos corregidos usan identidades explícitas; revisar ese diseño antes de agregar permisos por rol. No se deshabilitó registro global porque el proyecto aloja otros módulos (SMM/client tracker).
- CSP solo en observación, sin SRI en bibliotecas CDN; faltan pruebas completas de XSS almacenado, sesiones/MFA, backups/restauración, privilegios de servicio, rate limits e infraestructura del proveedor. No se certifica cumplimiento OWASP total.

## Licencias y activos

El archivo `audit-image-inventory.json` enumera 527 registros de imágenes de producto y 184 referencias principales (no son 711 fotos únicas: puede haber duplicados y miniaturas). Se retiraron parámetros query de URLs. Ningún registro contiene prueba de licencia. Obtener autor, origen, autorización comercial y condiciones por imagen. Que una imagen sea accesible o sea de un producto de marca no concede derechos de reproducción ni acredita autenticidad de la mercadería.

| Activo | Estado |
|---|---|
| assets/img/app-icon-1024.png, app-icon-512.png, logo-importb2b.png, logo-importb2b-transparent.png | Sin constancia de autoría/cesión en repo; confirmar titularidad y permiso comercial. |
| SVG inline de carrito, navegación, categorías, WhatsApp e Instagram en HTML/JS | No hay atribución/origen documentado por icono. Geometría y marcas requieren validar condiciones aplicables; no se afirma que pertenezcan a un paquete MIT. |
| Fuentes CSS Inter/system-ui/Segoe UI | No se encontraron archivos de fuente ni carga remota de Inter; se usa la fuente instalada/disponible. Si se distribuye Inter en el futuro, conservar licencia OFL del archivo concreto; no redistribuir fuentes del sistema sin licencia. |
| Supabase JS 2.57.4, PapaParse 5.5.3, jsPDF 2.5.1 | Licencias MIT verificadas en dependencia local/fuentes oficiales. Permiten uso comercial con sus condiciones y avisos. Esta tabla no atribuye esas licencias a imágenes o marcas. |

## Cookies

No se detectaron gtag/GTM, Google Analytics ni fbq/Meta Pixel en el repo o HTML/scripts propios inspeccionados. No se añadió un banner sin rastreadores que bloquear. Hay almacenamiento técnico de sesión/preferencias del panel y solicitudes técnicas a CDN, Storage y proveedores; no equivalen por sí solas a Analytics. Etiquetas inyectadas por hosting, scripts futuros o extensiones no quedan certificadas. Antes de agregar analítica/publicidad: bloqueo previo, aceptar y rechazar con facilidad equivalente, elección persistente, revocación, y prueba de red antes/después. No cargar la etiqueta para luego intentar desactivarla.

## Venta argentina: pendientes de titular

1. Completar identidad fiscal, domicilio, email de atención/privacidad, facturación, cobertura/plazos de entrega, cambios voluntarios y operación de reintegros. Validar las páginas con su asesor y designar atención a derechos/reclamos. Los campos visibles pendientes impiden afirmar cumplimiento completo.
2. Revisar precios por medio de pago: Ley 25.065 art. 37 y Res. 51/2017 impiden diferencias por tarjeta en un pago. Se corrigió el débito con recargo 12% observado en checkout, sin alterar precios base ni pedidos anteriores. Crédito tiene un 25% configurado sin detalle de plan: confirmar si es financiación real e informar cantidad/monto de cuotas y costos aplicables; si es en un pago, quitar la diferencia. La fórmula de gross-up de Ualá incluye procesamiento incluso en débito/crédito en un pago; no se habilitó ni se alteró el trabajo concurrente. No trasladar esa comisión como recargo prohibido. Revisar también Go Cuotas, impuestos y costo financiero antes de ofrecer condiciones firmes.
3. Confirmar registro de bases AAIP y contratos/transferencias; conservación con contador; licencias por imagen y marcas. No hay prueba de que esas obligaciones ya estén resueltas.
4. Categoría Vapers detectada. No es correcto usar sin más la antigua prohibición ANMAT 3226/2011: fue derogada por Disp. 2543/2026. El marco 549/2026, su modificatoria 796/2026 y normas operativas exigen revisar productos, registros, etiquetado, publicidad y protección de menores. No se verificaron habilitaciones ni situación de cada SKU; no se retiró mercadería o cambió stock. Requiere revisión sanitaria prioritaria con documentación de importador/proveedor y alcance del régimen transitorio.
5. Planificar actualización probada de jsPDF y controles de abuso de pedidos. Activar protección de contraseñas filtradas/MFA si el plan lo admite. Mantener secretos privados solo en entorno/almacén del servidor y limitar acceso al proyecto.

## Validación efectuada

- SQL `tests/audit-access.sql`: identidad ajena sin acceso a finanzas/perfiles ni recuento; permisos anon internos revocados; catálogo y pedidos conservados. Además, lectura positiva de movimientos y perfiles con ambos administradores existentes. Transacciones revertidas; sin cambios comerciales.
- CHECK de proveedores push validado contra suscripciones existentes. Función desplegada activa y JWT conservado. Prueba simulada de endpoint privado denegado, sin tráfico real ni push enviado.
- `tests/audit-security.mjs`: checkout sin aceptación no invoca RPC; con aceptación alcanza la llamada simulada; push rechaza destino privado; build excluye archivos internos.
- Checkout payments, catálogo WhatsApp, Ualá math/transporte, Ualá lifecycle/idempotencia, push notifications, notification inbox, purchase guard UI: pruebas satisfactorias. No son una prueba de cobro real ni de ejecución de toda la UI autenticada.
- El test histórico `tests/catalog.mjs` falla por su supuesto fijo de orden de categorías (espera Camisetas primera; el dato actual coloca Vapers). No se modificó catálogo ni su orden para satisfacerlo. `tests/audit-public.mjs` pasa contra Supabase: catálogo disponible, productos filtrados, sin campos de costo/owner, slug inexistente 404, método incorrecto 405 y reordenación anónima denegada.
- `npm audit --omit=dev`: cero avisos para dependencias del lockfile a la fecha. No incluye jsPDF/PapaParse servidos por CDN, funciones Deno o vulnerabilidades desconocidas.
- `git diff --check` con `cr-at-eol` por finales CRLF preexistentes. Pruebas de publicación web se deben verificar tras fusionar/desplegar, sin confundir commit con despliegue.

## Fuentes oficiales consultadas

- [Ley 25.326 actualizada](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/actualizacion), arts. 4–6, 9–12, 14, 16 y 21.
- [AAIP: ejemplos prácticos de bases empresariales](https://www.argentina.gob.ar/aaip/datospersonales/responsables/basesainformar/ejemplos) y [obligaciones](https://www.argentina.gob.ar/aaip/datospersonales/responsables/obligaciones).
- [Ley 24.240 actualizada](https://www.argentina.gob.ar/normativa/nacional/ley-24240-638/actualizacion), [Código Civil y Comercial](https://www.argentina.gob.ar/normativa/nacional/norma-235975/actualizacion).
- [Disposición 954/2025](https://www.boletinoficial.gob.ar/pdf/aviso/primera/330827/20250904), que reemplazó la Res. 424/2020, y [Disposición 3/2026](https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-3-2026-423007/texto).
- [Ley 25.065](https://www.argentina.gob.ar/normativa/nacional/ley-25065-55556/actualizacion) y [Res. 51/2017](https://www.boletinoficial.gob.ar/detalleAviso/primera/158269/20170125).
- [Resolución Salud 549/2026 y notas de modificación](https://www.argentina.gob.ar/normativa/nacional/norma-425443/texto), [Disp. ANMAT 2543/2026](https://www.boletinoficial.gob.ar/pdf/aviso/primera/341513/20260512).
- [Supabase: RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [avisos SECURITY DEFINER](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0029_authenticated_security_definer_function_executable), [contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [tablas sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- [Changelog Supabase](https://supabase.com/changelog), cambios de exposición Data API y Postgres 15.19/17.11 revisados; no se ejecutaron upgrades de base.
- [Avisos jsPDF del proveedor](https://github.com/parallax/jsPDF/security/advisories), [licencia jsPDF](https://raw.githubusercontent.com/parallax/jsPDF/v2.5.1/LICENSE), [licencia PapaParse](https://raw.githubusercontent.com/mholt/PapaParse/5.5.3/LICENSE).
- [Chromium: endpoint push heredado](https://chromium.googlesource.com/chromium/src/+/refs/tags/148.0.7734.4/components/push_messaging/push_messaging_constants.cc).
