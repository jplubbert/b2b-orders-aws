# SPEC — Pedidos B2B (demo)
Versión: 3  ·  Corte 1: approved  ·  Corte 2: approved  ·  Corte 3: approved  ·  Nivel de riesgo (10.4): corte 1 funcionalidad mediana; corte 2 bajo (solo app, sin backend ni deploy); corte 3 funcionalidad mediana (rol nuevo, contrato y autorización)

## Objetivo (≤1 página)
Para el **almacenero**, que necesita reponer mercadería de su distribuidor sin depender de llamadas
o mensajes, el sistema le permite iniciar sesión, ver el catálogo con precios vigentes, armar y
confirmar un pedido, y consultar en qué estado está.
¿Y qué?: frente al pedido por teléfono/mensajería (alternativa supuesta, S-10), el almacenero ve
precios y total antes de confirmar y sabe el estado sin preguntar; el distribuidor recibe pedidos
estructurados.
Criterio de éxito: en una demo de ≤3 minutos en un teléfono, un almacenero de prueba inicia
sesión, confirma un pedido de ≥2 productos, lo ve en `RECIBIDO` y, tras cambiar el estado con el
script del distribuidor, lo ve en `ENVIADO` al refrescar; las pruebas de aceptación REQ-001..004
pasan contra el entorno `dev`.
Criterio de éxito (corte 3, reemplaza el script en la demo): en el teléfono, el almacenero confirma
un pedido y lo ve "Recibido"; el distribuidor inicia sesión en la misma app, filtra "Recibido",
pasa ese pedido a "Enviado"; el almacenero vuelve a entrar, refresca y lo ve "Enviado", sin usar
`order:set-status`. Las pruebas de aceptación REQ-001..004 y REQ-009..011 pasan contra `dev`.

## Alcance
- Incluido (corte 1): inicio y cierre de sesión con usuario precreado; catálogo único; carrito en
  el dispositivo; confirmación de pedido con precio calculado en servidor; lista y detalle de
  mis pedidos con estado; script para que el distribuidor cambie el estado.
- Incluido (corte 2, solo app): barra superior ordenada con "Cerrar sesión" fuera de la barra
  (REQ-006); diseño visual consistente para una demo comercial (REQ-007); detalle de producto
  (REQ-008). Sin cambios de backend, contrato, infraestructura ni despliegue.
- Incluido (corte 3): rol distribuidor en la misma app (grupo Cognito `distribuidores`, REQ-009);
  panel con todos los pedidos de todos los almacenes y filtro por estado (REQ-010); cambio de
  estado de un pedido desde la app (REQ-011). Responde Q-02 para la demo. El script
  `order:set-status` sigue existiendo para pruebas y soporte, pero la demo ya no lo usa.
- Excluido explícitamente: auto-registro y recuperación de contraseña; pagos y facturación;
  control de stock; backoffice del distribuidor más allá del corte 3 (alta de usuarios, catálogo y precios desde la app); notificaciones push y suscripciones en tiempo
  real; modo offline; varios distribuidores; listas de precios por cliente; imágenes, búsqueda y
  filtros del catálogo; editar o cancelar un pedido confirmado; publicación en tiendas.
- Cortes futuros: catálogo y precios desde la app del distribuidor, búsqueda/categorías, cancelación,
  notificaciones de cambio de estado, varios usuarios por almacén.

## Restricciones
- R-01 Stack: AWS Cognito, AppSync, Lambda, DynamoDB; cliente React Native — fuente: usuario
- R-02 Es una demo: un entorno `dev`, sin recursos de costo fijo (todo serverless/on-demand) — fuente: usuario (demo) · DEC-001, DEC-006
- R-03 Las decisiones técnicas las toma el agente y las registra sin preguntar — fuente: usuario, LOG 2026-10-17
- R-04 Despliegue `dev` con el perfil AWS `pedidos-demo` (cuenta [REDACTED_AWS_ACCOUNT_DEMO], credenciales temporales de IAM Identity Center: `aws sso login --sso-session pepe`, permission set `AdministratorAccess`) en `us-east-1` — fuente: usuario, LOG 2026-10-18 (antes: rol `OrganizationAccountAccessRole` asumido desde `default` — DEC-014; y antes, perfil `default` en [REDACTED_AWS_ACCOUNT_MAIN] — Q-01, LOG 2026-10-17; DEC-017)

## Glosario
- Almacenero: dueño o encargado de un almacén; cliente B2B del distribuidor; actor de la app (grupo `almaceneros`).
- Distribuidor: empresa que vende al almacenero y procesa los pedidos; en el corte 1 actúa por script; desde el corte 3 es un usuario de la app del grupo `distribuidores`, sin `customerId`.
- Panel del distribuidor: pantalla "Pedidos" con los pedidos de todos los almacenes (REQ-010).
- Cliente: almacén identificado por `customerId`; en el corte 1, un usuario = un cliente (S-01).
- Catálogo: conjunto de productos activos que el distribuidor ofrece a todos los clientes.
- Producto: artículo con `productId`, nombre, presentación (p. ej. "Caja x 12 u."), precio unitario y si está activo.
- Carrito: líneas en preparación en el dispositivo, aún no enviadas.
- Pedido: conjunto confirmado de líneas, con número, fecha, total y estado; inmutable salvo su estado.
- Línea: producto + cantidad entera + precio unitario congelado al confirmar.
- Estado del pedido: `RECIBIDO` | `EN_PREPARACION` | `ENVIADO` | `ENTREGADO` | `CANCELADO` (S-04).
- Monto: entero en pesos chilenos (CLP), sin decimales (S-02).

## Requisitos
### REQ-001 Inicio de sesión · estado: approved_for_impl · prioridad: must
Cuando el almacenero ingresa correo y contraseña válidos, el sistema deberá abrir el catálogo.
Cuando el almacenero vuelve a abrir la app con una sesión vigente, el sistema deberá abrir el catálogo sin pedir credenciales.
Si las credenciales son inválidas, entonces el sistema deberá mostrar "Correo o contraseña incorrectos" y permanecer en la pantalla de inicio.
Si una solicitud a la API llega sin token válido, entonces el sistema deberá rechazarla sin devolver datos.
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | `almacen1@demo.test` / contraseña correcta | se muestra el catálogo |
| E2 negativo | `almacen1@demo.test` / contraseña errónea | mensaje "Correo o contraseña incorrectos"; sigue en inicio |
| E3 borde | sesión iniciada, app cerrada y reabierta | catálogo sin pedir credenciales |
| E4 negativo | `listProducts` sin cabecera Authorization | error `Unauthorized`; sin datos |
Trazas: §Objetivo · decisiones: DEC-003, DEC-004 · prueba: tests/acceptance/req_001_*

### REQ-002 Ver catálogo · estado: approved_for_impl · prioridad: must
Cuando el almacenero abre el catálogo, el sistema deberá listar los productos activos ordenados por nombre, con nombre, presentación y precio unitario.
Si no hay productos activos, entonces el sistema deberá mostrar "No hay productos disponibles".
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | activos: "Yerba 1 kg" $4.500, "Arroz 1 kg" $1.300 | se listan "Arroz 1 kg" y luego "Yerba 1 kg" con sus precios |
| E2 negativo | "Aceite 900 ml" con `active=false` | no aparece |
| E3 borde | ningún producto activo | mensaje "No hay productos disponibles" |
Trazas: §Objetivo · decisiones: DEC-005, DEC-006 · prueba: tests/acceptance/req_002_*

### REQ-003 Armar y confirmar pedido · estado: approved_for_impl · prioridad: must
Cuando el almacenero agrega productos al carrito o cambia cantidades, el sistema deberá mostrar el subtotal por línea y el total del carrito.
Cuando el almacenero confirma un carrito válido, el sistema deberá crear un pedido en estado `RECIBIDO` con los precios vigentes del catálogo calculados en el servidor, vaciar el carrito y mostrar el número de pedido.
El servidor deberá fusionar las líneas del mismo producto antes de validar.
Si una línea fusionada tiene cantidad fuera de 1–999, el producto no existe o está inactivo, o el carrito está vacío o supera 50 líneas, entonces el sistema deberá rechazar el pedido completo, indicar el motivo y no persistir nada.
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | 2 × "Yerba 1 kg" ($4.500) + 5 × "Arroz 1 kg" ($1.300) | pedido `RECIBIDO`, total $15.500 (`total: 15500`), carrito vacío |
| E2 borde | cliente envía precio unitario $1 para "Yerba 1 kg" | se ignora; el pedido usa $4.500 |
| E3 negativo | cantidad 0 o 1000 | rechazo `INVALID_QUANTITY`; sin pedido |
| E4 negativo | producto inactivo o inexistente | rechazo `PRODUCT_UNAVAILABLE` con el `productId`; sin pedido |
| E5 negativo | carrito vacío | botón Confirmar deshabilitado; API rechaza `EMPTY_ORDER` |
| E6 borde | mismo producto en dos líneas (2 y 3) | el servidor las fusiona: una línea con cantidad 5 |
| E7 negativo | 51 productos distintos, cantidad 1 cada uno | rechazo `TOO_MANY_LINES`; sin pedido |
Trazas: §Objetivo · decisiones: DEC-004, DEC-005, DEC-006 · prueba: tests/acceptance/req_003_*

### REQ-004 Ver estado de mis pedidos · estado: approved_for_impl · prioridad: must
Cuando el almacenero abre "Mis pedidos", el sistema deberá listar sus pedidos del más reciente al más antiguo con número, fecha, total y estado.
Cuando el almacenero abre un pedido, el sistema deberá mostrar sus líneas con precios congelados y su estado actual.
Cuando el almacenero refresca la lista o vuelve a la pantalla, el sistema deberá mostrar el estado vigente.
Si el almacenero solicita un pedido de otro cliente, entonces el sistema deberá responder como si no existiera.
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | almacen1 tiene pedidos del 15/10 y del 16/10 | se lista primero el del 16/10 |
| E2 positivo | distribuidor pasa el pedido a `ENVIADO` por script; almacenero refresca | se ve `ENVIADO` |
| E3 negativo | almacen2 pide `order(id)` de un pedido de almacen1 | `null` / no encontrado; sin datos |
| E4 borde | cliente sin pedidos | mensaje "Todavía no hiciste pedidos" |
| E5 borde | precio de catálogo cambia después de confirmar | el detalle mantiene el precio congelado |
Trazas: §Objetivo · decisiones: DEC-004, DEC-006 · prueba: tests/acceptance/req_004_*

### REQ-005 Cerrar sesión · estado: approved_for_impl · prioridad: should
Cuando el almacenero elige "Cerrar sesión", el sistema deberá borrar la sesión local y volver a la pantalla de inicio.
Si después de cerrar sesión se reabre la app, entonces el sistema deberá pedir credenciales.
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | sesión iniciada → "Cerrar sesión" | pantalla de inicio; carrito vacío |
| E2 borde | tras cerrar sesión, reabrir la app | pide credenciales |
Trazas: §Objetivo · decisiones: DEC-003, DEC-004 · prueba: tests/acceptance/req_005_* (manual en corte 1, DEC-007)

### REQ-006 Barra superior ordenada · estado: approved_for_impl · prioridad: must · corte 2
Cuando el almacenero está en el catálogo, el sistema deberá mostrar en la barra superior el título "Catálogo" y, separados del título, el acceso a "Mis pedidos" y un botón de cuenta.
Cuando el almacenero toca el botón de cuenta, el sistema deberá mostrar un menú con el correo de la sesión y la opción "Cerrar sesión" (REQ-005).
Mientras el almacenero está en el catálogo, el sistema deberá mostrar una barra inferior fija con la cantidad de unidades y el total del carrito que abre el carrito.
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | almacen1 en el catálogo | barra: "Catálogo" a la izquierda; "Mis pedidos" y botón de cuenta a la derecha; "Cerrar sesión" no está en la barra |
| E2 positivo | botón de cuenta → "Cerrar sesión" | se cumple REQ-005 E1 (inicio, carrito vacío) |
| E3 borde | se abre el menú de cuenta y se cierra sin elegir (tocar fuera o "Cancelar") | sigue en el catálogo con la sesión y el carrito intactos |
| E4 positivo | 2 Arroz + 1 Yerba en el carrito | barra inferior "Ver carrito · 3 u. · $7.100"; al tocarla abre Carrito |
| E5 borde | carrito vacío | barra inferior "Carrito vacío"; abre Carrito con "Confirmar pedido" deshabilitado (REQ-003 E5) |
| E6 borde | teléfono de 360 dp de ancho | título, "Mis pedidos" y botón de cuenta no se superponen ni se cortan (manual, DEC-011) |
Trazas: §Alcance corte 2 · decisiones: DEC-003, DEC-012 · prueba: app/test/header.test.tsx (S-20) + manual E6

### REQ-007 Diseño visual consistente · estado: approved_for_impl · prioridad: must · corte 2
El sistema deberá dibujar todas las pantallas (Inicio de sesión, Catálogo, Detalle de producto, Carrito, Mis pedidos, Detalle de pedido) con un único tema de colores, espaciado y tipografía.
El sistema deberá mostrar el estado del pedido como una etiqueta de color con su nombre legible (S-17).
El sistema deberá mostrar carga, lista vacía y error con el mismo componente en todas las pantallas, conservando los textos de REQ-001..005.
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | fuentes de `app/src/app` y `app/src/components` | ningún color literal (`#…`, `rgb(…)`) ni `fontSize` numérico fuera de `app/src/theme.ts` |
| E2 negativo | cada par texto/fondo declarado en el tema | contraste ≥ 4,5:1 (WCAG AA); un par por debajo hace fallar la prueba |
| E3 positivo | pedidos en los 5 estados de S-04 | etiquetas "Recibido", "En preparación", "Enviado", "Entregado", "Cancelado", cada una con su color |
| E4 borde | controles táctiles (− / +, botones, enlaces de la barra) | área táctil ≥ 44 × 44 dp |
| E5 borde | REQ-002 E3, REQ-004 E4, error de red | "No hay productos disponibles" / "Todavía no hiciste pedidos" / mensaje de error, con el mismo componente de estado |
| E6 positivo | recorrido del criterio de éxito en el teléfono | todas las pantallas se ven del mismo sistema visual (manual, DEC-011) |
Trazas: §Alcance corte 2 · decisiones: DEC-012 · prueba: app/test/theme.test.tsx, app/test/*.test.tsx (S-20) + manual E6

### REQ-008 Detalle de producto · estado: approved_for_impl · prioridad: must · corte 2
Cuando el almacenero toca un producto del catálogo, el sistema deberá abrir su detalle con nombre, presentación, precio unitario, la cantidad que ya tiene en el carrito y el subtotal de esa cantidad.
Cuando el almacenero cambia la cantidad en el detalle, el sistema deberá actualizar el mismo carrito que usa el catálogo (REQ-003).
Si el producto no está en el catálogo cargado, entonces el sistema deberá mostrar "Este producto ya no está disponible" y no permitir agregarlo.
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | tocar "Arroz 1 kg" en el catálogo | detalle con "Arroz 1 kg", su presentación y $1.300; cantidad 0 |
| E2 positivo | en el detalle, + dos veces | cantidad 2, subtotal $2.600; al volver, el catálogo y la barra del carrito muestran 2 u. |
| E3 borde | "Yerba 1 kg" ya tiene 3 en el carrito | el detalle abre con cantidad 3 y subtotal $13.500 |
| E4 borde | en el detalle, bajar de 1 a 0 | el producto sale del carrito |
| E5 negativo | ruta `/product/<id>` con un id que no está en el catálogo cargado | "Este producto ya no está disponible", sin − / +, con botón "Volver al catálogo" |
Trazas: §Alcance corte 2 · decisiones: DEC-003, DEC-012 · prueba: app/test/product.test.tsx (S-20) + manual en teléfono

### REQ-009 Acceso por rol · estado: approved_for_impl · prioridad: must · corte 3
Cuando un usuario del grupo `distribuidores` inicia sesión, el sistema deberá abrir el panel "Pedidos" en lugar del catálogo.
Cuando un usuario del grupo `almaceneros` inicia sesión, el sistema deberá abrir el catálogo como hasta ahora (REQ-001).
Cuando un usuario vuelve a abrir la app con una sesión vigente, el sistema deberá abrir la pantalla de su rol sin pedir credenciales.
Si el usuario no pertenece a ninguno de los dos grupos, entonces el sistema deberá mostrar "Tu usuario no tiene acceso a la app", cerrar la sesión y permanecer en inicio.
Si un usuario llama una operación de la API que no corresponde a su rol, entonces el sistema deberá rechazarla con `Unauthorized` sin devolver datos.
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | `distribuidor@demo.test` / contraseña correcta | se muestra el panel "Pedidos" |
| E2 positivo | `almacen1@demo.test` / contraseña correcta | se muestra el catálogo (sin cambios) |
| E3 negativo | usuario válido sin grupo | "Tu usuario no tiene acceso a la app"; sigue en inicio, sin sesión |
| E4 borde | distribuidor con sesión, app cerrada y reabierta | panel "Pedidos" sin pedir credenciales |
| E5 negativo | almacenero llama `allOrders` o `setOrderStatus` | error `Unauthorized`; sin datos ni cambios |
| E6 negativo | distribuidor llama `myOrders`, `order` o `createOrder` | error `Unauthorized`; sin datos ni pedido creado |
Trazas: §Alcance corte 3 · decisiones: DEC-004, DEC-013 · prueba: tests/acceptance/req_009_* (E5, E6) + app/test (E1–E4, S-27) + manual E1, E4

### REQ-010 Panel de pedidos del distribuidor · estado: approved_for_impl · prioridad: must · corte 3
Cuando el distribuidor abre el panel, el sistema deberá listar los pedidos de todos los almacenes del más reciente al más antiguo con número, almacén, fecha, total y estado.
Cuando el distribuidor elige un estado en el filtro, el sistema deberá mostrar solo los pedidos en ese estado; "Todos" quita el filtro.
Cuando el distribuidor abre un pedido, el sistema deberá mostrar el almacén, sus líneas con precios congelados, el total y el estado actual.
Cuando el distribuidor refresca el panel o vuelve a él, el sistema deberá mostrar el estado vigente (S-06).
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | almacen1 confirma un pedido y luego almacen2 otro | ambos aparecen; primero el de almacen2; cada uno con su almacén |
| E2 positivo | filtro "Enviado" con pedidos en `RECIBIDO` y `ENVIADO` | solo los `ENVIADO` (`allOrders(status: ENVIADO)`) |
| E3 borde | filtro sin pedidos en ese estado | mensaje "No hay pedidos en este estado" |
| E4 borde | ningún pedido en el sistema | mensaje "Todavía no hay pedidos" |
| E5 positivo | abrir un pedido de almacen1 de 2 Yerba + 5 Arroz | almacén, 2 líneas con $4.500 y $1.300, total $15.500 y estado |
Trazas: §Alcance corte 3 · decisiones: DEC-006, DEC-013 · prueba: tests/acceptance/req_010_* (E1, E2, E5 por API) + app/test (E2–E5) + manual en teléfono

### REQ-011 Cambiar estado de un pedido · estado: approved_for_impl · prioridad: must · corte 3
Cuando el distribuidor elige un estado nuevo en el detalle de un pedido, el sistema deberá guardar ese estado y mostrarlo en el detalle y en el panel.
Cuando el almacenero dueño del pedido refresca "Mis pedidos" o el detalle, el sistema deberá mostrar el estado nuevo (REQ-004).
El sistema deberá cambiar solo el estado: líneas, precios, total, número y fecha quedan iguales.
Si el pedido no existe, entonces el sistema deberá rechazar el cambio con `ORDER_NOT_FOUND` sin modificar nada.
Ejemplos (aceptación):
| caso | entrada / contexto | resultado esperado |
|---|---|---|
| E1 positivo | pedido `RECIBIDO` → el distribuidor elige "En preparación" | respuesta y panel con `EN_PREPARACION` |
| E2 positivo | distribuidor pasa el pedido de almacen1 a `ENVIADO`; almacen1 refresca | almacen1 ve "Enviado" (reemplaza el script de REQ-004 E2 en la demo) |
| E3 borde | pedido ya `ENVIADO` → se elige `ENVIADO` | sin error; estado `ENVIADO`; nada más cambia |
| E4 borde | tras el cambio, comparar con el pedido original | mismas líneas, total, número y `createdAt` |
| E5 negativo | `setOrderStatus` con un `id` inexistente (o con el `customerId` de otro almacén) | rechazo `ORDER_NOT_FOUND`; no se crea ni modifica ningún pedido |
| E6 negativo | `setOrderStatus` con estado `PERDIDO` | AppSync rechaza la solicitud (no es de S-04); el pedido no cambia |
| E7 negativo | el cambio falla por red en la app | mensaje "No se pudo cambiar el estado" y el detalle conserva el estado anterior |
Trazas: §Alcance corte 3 · decisiones: DEC-005, DEC-013 · prueba: tests/acceptance/req_011_* (E1–E6 por API) + app/test (E1, E7) + manual en teléfono (criterio de éxito del corte 3)

## Supuestos (no bloqueantes, con valor por defecto)
| ID | creemos que… | valor por defecto | clase | disparador de revisión |
|---|---|---|---|---|
| S-01 | un usuario representa a un solo almacén | `customerId` = atributo Cognito `custom:customerId`, 1 usuario por cliente | reversible (DEC-004 lo deja aditivo) | se pide más de un usuario por almacén |
| S-02 | hay una sola moneda | CLP, montos enteros en pesos (sin decimales), formato `es-CL` (`$15.500`) | reversible | otro país o multimoneda |
| S-03 | no se controla stock ni pedido mínimo | cantidad entera 1–999; máx. 50 líneas | reversible | el distribuidor pide stock o mínimo |
| S-04 | estados del pedido | los 5 del glosario; nuevo = `RECIBIDO`; el almacenero no cancela | reversible (enum aditivo) | backoffice (Q-02) |
| S-05 | precio que rige | el vigente al confirmar, congelado en la línea; no se avisa si cambió | reversible | quejas por diferencia de precio |
| S-06 | actualización del estado | al refrescar o volver a la pantalla; sin push ni suscripciones | reversible | se pide aviso en tiempo real |
| S-07 | catálogo | único para todos los clientes | reversible (lista de precios aditiva) | precios por cliente |
| S-08 | idioma | interfaz en español | reversible | — |
| S-09 | persistencia del carrito | solo en memoria; se pierde al cerrar la app o la sesión | reversible | se pide conservar el carrito |
| S-10 | alternativa actual | pedidos por teléfono/mensajería al preventista | no bloqueante | el usuario lo corrige |
| S-11 | número de pedido | 8 caracteres finales del ULID en mayúsculas | reversible | se pide numeración correlativa |
| S-12 | REQ-003 E2 ("precio $1 se ignora") busca que el servidor nunca use un precio del cliente | la entrada de `createOrder` no tiene campo de precio (DEC-009): si se envía, AppSync rechaza la solicitud sin crear pedido; sin precio, el pedido usa el de catálogo ($4.500) | reversible (se puede aceptar e ignorar un campo opcional) | se pide que la app pueda mandar precios |
| S-13 | REQ-004 E1 ("pedidos del 15/10 y del 16/10") se refiere al orden por fecha de confirmación | la aceptación crea dos pedidos seguidos y espera el más nuevo primero; no se fijan fechas pasadas | reversible | se pide importar pedidos con fecha |
| S-14 | los ejemplos de REQ-003/004 no exigen usar `almacen1` | la aceptación usa clientes desechables del grupo `almaceneros` (`acept-*@demo.test`, borrados al terminar) para no ensuciar el historial de la demo; `almacen2` solo lee en REQ-004 E3 | reversible | — |
| S-15 | "Cerrar sesión pegado a Catálogo" se resuelve sacándolo de la barra | menú de cuenta (botón con la inicial del correo, a la derecha) con correo + "Cerrar sesión" + "Cancelar"; sin confirmación extra; el carrito pasa a una barra inferior fija del catálogo | reversible | el usuario prefiere pestañas inferiores |
| S-16 | identidad visual de la demo | marca neutra "Pedidos B2B"; color primario azul (#1D4ED8), fondos claros, sin modo oscuro; tipografía del sistema (sin fuentes nuevas); escala de espaciado 4/8/12/16/24/32 y 5 tamaños de texto (12/14/16/20/28) | reversible (todo en `theme.ts`) | el usuario trae marca o colores propios |
| S-17 | nombres legibles del estado | RECIBIDO → "Recibido", EN_PREPARACION → "En preparación", ENVIADO → "Enviado", ENTREGADO → "Entregado", CANCELADO → "Cancelado"; la API sigue usando los valores de S-04 | reversible | se pide mostrar el código tal cual |
| S-18 | el detalle de producto no muestra imagen | las imágenes siguen excluidas (§Alcance): un recuadro con la inicial del producto ocupa su lugar; sin descripción larga (el contrato no la tiene) | reversible | se agregan imágenes o descripción al catálogo (backend) |
| S-19 | origen de los datos del detalle | el catálogo ya cargado en la app (sin consulta nueva ni cambio de contrato); si el id no está, REQ-008 E5 | reversible (`product(id)` aditivo en un corte con backend) | se abre el detalle desde un enlace externo |
| S-20 | aceptación de REQ-006..008 | son solo de UI: pruebas de componentes con jest en `app/test/` (no protegidas) + verificación manual en el teléfono (DEC-007, DEC-011); no hay tarea de spec ni cambios en `tests/acceptance/` | reversible | se agregan pruebas end-to-end de UI |
| S-21 | textos visibles de REQ-001..005 | se conservan literalmente; el pulido no cambia textos ni flujos | no bloqueante | — |
| S-22 | un único distribuidor | todos los usuarios del grupo `distribuidores` ven todos los pedidos; usuario de demo `distribuidor@demo.test` (seed, misma contraseña de demo) sin `custom:customerId` | reversible (varios distribuidores = atributo aditivo) | se piden varios distribuidores |
| S-23 | "almacén" en el panel | se muestra el `customerId` del pedido (p. ej. `C-ALMACEN1`); no hay nombre de almacén en el modelo | reversible (nombre aditivo en el seed/token) | se pide el nombre comercial |
| S-24 | transiciones de estado | el distribuidor puede pasar un pedido a cualquiera de los 5 estados, sin orden obligatorio ni confirmación extra (igual que el script); elegir el mismo estado no es error | reversible | el distribuidor pide reglas de flujo (p. ej. `ENTREGADO` final) |
| S-25 | un usuario en ambos grupos | no lo crea el seed; si ocurre, la app abre el panel del distribuidor y la API autoriza cada operación según sus grupos | reversible | se pide cambiar de rol en la app |
| S-26 | volumen | el panel trae todos los pedidos sin paginar (demo: decenas) | reversible (paginación aditiva) | más de 1.000 pedidos (DEC-013) |
| S-27 | aceptación de la UI del panel | como S-20: jest en `app/test/` + verificación manual en el teléfono (DEC-011); la API se prueba en `tests/acceptance/` (tarea de spec T-13) | reversible | — |
| S-28 | textos de la UI del distribuidor | panel "Pedidos"; filtro "Todos" + los 5 nombres de S-17; detalle "Pedido <número>" con "Cambiar estado"; menú de cuenta igual al del almacenero (REQ-006) | reversible | — |

## Preguntas abiertas
| ID | pregunta | clase | bloquea a | responsable | vence |
|---|---|---|---|---|---|
| Q-01 | ¿Qué cuenta/perfil AWS y región uso para desplegar `dev`? — **resuelta 2026-10-17**: perfil `default`, `us-east-1` (R-04); **cambiada por el usuario 2026-10-18**: perfil `pedidos-demo`, cuenta [REDACTED_AWS_ACCOUNT_DEMO] (R-04, DEC-014) | bloqueante | — | usuario | — |
| Q-02 | ¿Quién y cómo cambia el estado del pedido en la operación real? — **respondida para la demo 2026-10-18** por el encargo del corte 3: el distribuidor, desde la misma app (REQ-009..011) | diferible | — | usuario | — |

## Plan (corte 1)
### Diseño
- `app/` (Expo): pantallas Inicio de sesión, Catálogo, Carrito, Mis pedidos, Detalle de pedido. Auth y GraphQL con `aws-amplify` v6 como librería cliente (DEC-003).
- AppSync: contrato `spec/contracts/schema.graphql` (creado en T-01). Operaciones previstas:
  `listProducts`, `myOrders`, `order(id)`, `createOrder(input: {lines: [{productId, quantity}]})`.
- Lambda `api` (Node.js 24, TS, esbuild): enruta por `fieldName`; dominio puro en `backend/src/domain` (DEC-005).
- DynamoDB: tabla única on-demand (DEC-006). Cognito: user pool + grupo `almaceneros` (DEC-004).
- Scripts: `seed` (productos y usuarios `almacen1`, `almacen2`), `order:set-status <id> <estado>`.
- Decisiones globales aplicadas: DEC-001..DEC-007 (cada una con su Confirmación).

### Orden y dependencias
1. T-01 Esqueleto andante — ejercita DEC-001..007 de punta a punta (sin dependencias)
2. T-02 Guardas mecánicas del protocolo — independiente
3. T-03 Pruebas de aceptación REQ-001..004 (tarea de spec) — depende de T-01
4. T-04 Catálogo (REQ-002) — depende de T-01, T-03
5. T-05 Armar y confirmar pedido (REQ-003) — depende de T-04
6. T-06 Estado de mis pedidos (REQ-004) — depende de T-05
7. T-07 Sesión completa y cierre (REQ-001, REQ-005) — depende de T-01, T-03; independiente de T-04..06

### Riesgos y spikes
| riesgo | spike | pregunta | plazo | criterio de éxito |
|---|---|---|---|---|
| `aws-amplify` v6 en Expo Go | dentro de T-01 | ¿El login SRP funciona en Expo Go o hace falta development build? | 2 h | login real desde teléfono; si requiere dev build, se usa `expo run:*` y se anota en LOG (no es DEC nueva) |
| Arranque en frío de Lambda | no; medir en T-01 | ¿La demo se siente lenta? | — | primera respuesta < 3 s, siguientes < 1 s en `dev` |

## Criterio de cierre del corte (declarado antes del análisis)
- [x] Objetivo y exclusiones confirmados por el responsable
- [x] Cada REQ con ID, ≥1 ejemplo positivo y ≥1 negativo/borde
- [x] Sin preguntas bloqueantes/costosas abiertas que el corte consuma (Q-01 resuelta)
- [x] Decisiones globales consumidas en `accepted` o con spike en curso (DEC-001..007 `accepted`)
- [x] Conjunto coherente: objetivo→REQ→ejemplo, sin conflictos, glosario
- [x] Revisión independiente sin bloqueos nuevos (2 bloqueos encontrados y resueltos, LOG 2026-10-17)
- Presupuesto del bloque B2: 1 sesión; al agotarse: cortar (REQ-005 es el primero en salir)

## Plan (corte 2, solo app)
### Diseño
- `app/src/theme.ts`: tokens de color, espaciado, radios, tipografía y estados del pedido (DEC-012).
- `app/src/components/`: `Screen`, `Button`, `Card`, `StatusBadge`, `StateMessage` (carga/vacío/error), `AccountMenu` (modal de RN), `CartBar`; `QuantityStepper` y `SignOutButton` pasan al tema.
- Navegación: misma pila de Expo Router; nueva ruta `product/[id]`; barra de la pila estilizada desde `_layout.tsx`.
- Datos del detalle: el catálogo cargado se guarda en un contexto de la app junto al carrito (S-19). Sin cambios en `backend/`, `infra/`, `spec/contracts/` ni `tests/acceptance/`; sin dependencias nuevas.

### Orden y dependencias
1. T-09 Tema y componentes base (REQ-007) — sin dependencias del corte 2
2. T-10 Barra superior, menú de cuenta y barra del carrito (REQ-006) — depende de T-09
3. T-11 Detalle de producto (REQ-008) — depende de T-09, T-10
4. T-12 Pulido de Inicio, Carrito, Mis pedidos y Detalle de pedido (REQ-007) — depende de T-09; última por tocar todas las pantallas

### Riesgos
| riesgo | mitigación |
|---|---|
| El rediseño rompe un flujo ya aceptado (REQ-001..005) | S-21 + las pruebas de `app/test` existentes siguen pasando; `npm run test:acceptance` no cambia (sin backend) |
| La barra se ve distinta en Android e iOS | verificación manual en el teléfono del usuario (Android, Expo Go 57) |

## Criterio de cierre del corte 2
- [x] REQ-006..008 y S-15..S-21 aprobados por el responsable (José Pedro Lübbert, 2026-10-18)
- [x] DEC-012 `accepted`
- [x] Cada REQ con ≥1 ejemplo positivo y ≥1 negativo/borde (hecho en la propuesta)
- [x] Sin preguntas bloqueantes (ninguna abierta)

## Plan (corte 3, panel del distribuidor)
### Diseño
- Cognito: grupo nuevo `distribuidores`; el seed crea `distribuidor@demo.test` sin `custom:customerId` (S-22).
- Contrato (DEC-013): `Order.customerId: ID!`; `Query.allOrders(status: OrderStatus): [Order!]!` y `Mutation.setOrderStatus(customerId: ID!, id: ID!, status: OrderStatus!): Order!` solo para `distribuidores`; `myOrders`, `order`, `createOrder` y `listProducts` solo para `almaceneros`; tipos visibles para ambos grupos. Error nuevo `ORDER_NOT_FOUND`.
- Backend: `identityFromClaims` devuelve el rol (almacenero con `customerId` o distribuidor) y cada resolver declara qué rol acepta (doble control con `@aws_auth`). `allOrders` = Scan paginado de `ORDER#*` ordenado por ULID descendente con filtro opcional por estado; `setOrderStatus` = UpdateItem condicional en `CUSTOMER#<customerId>/ORDER#<id>` que solo toca `status`. La Lambda gana `Scan` y `UpdateItem` sobre la tabla.
- App: tras el login (y al reabrir) se leen los grupos del token (`fetchAuthSession`): `/catalog`, `/dist` o rechazo (REQ-009 E3). Rutas nuevas `dist/index` (panel con filtro) y `dist/order/[id]` (detalle desde el panel ya cargado, como S-19, y botones de estado). Mismo tema y componentes del corte 2 (DEC-012), sin dependencias nuevas.
- Despliegue: un solo `npm run deploy:dev` al cerrar el backend (T-14); en autopilot queda como `- Pendiente deploy:`.

### Orden y dependencias
1. T-13 Pruebas de aceptación REQ-009..011 (tarea de spec) — sin dependencias del corte 3
2. T-14 Backend: rol distribuidor, `allOrders` y `setOrderStatus` (REQ-009 E5–E6, REQ-010, REQ-011) — **requiere deploy** — depende de T-13
3. T-15 App: acceso por rol y panel de pedidos con filtro (REQ-009 E1–E4, REQ-010) — solo app — depende de T-14 (contrato y tipos generados)
4. T-16 App: detalle del pedido y cambio de estado + guion de demo sin script (REQ-010 E5, REQ-011) — solo app — depende de T-15

### Riesgos
| riesgo | mitigación |
|---|---|
| El cambio de autorización rompe al almacenero (REQ-001..004) | `test:acceptance` completo (req_001..004 siguen pasando) es parte del `verify` de T-14 |
| `@aws_auth` por campo con varios grupos se comporta distinto de lo esperado | REQ-009 E5–E6 contra `dev` real; prueba de plantilla del esquema en `infra/test` |
| Scan de todos los pedidos se vuelve lento | S-26; DEC-013 anota el GSI aditivo como salida |
| Una sola persona con un teléfono hace de los dos roles | la demo cierra sesión entre roles (menú de cuenta); con dos teléfonos se omite |

## Criterio de cierre del corte 3
- [x] REQ-009..011 y S-22..S-28 aprobados por el responsable (José Pedro Lübbert, 2026-10-18)
- [x] DEC-013 `accepted`
- [x] Cada REQ con ≥1 ejemplo positivo y ≥1 negativo/borde (hecho en la propuesta)
- [x] Sin preguntas bloqueantes (Q-02 respondida para la demo)
