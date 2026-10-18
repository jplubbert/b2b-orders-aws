# SPEC — Pedidos B2B (demo)
Versión: 2  ·  Corte 1: approved  ·  Corte 2: proposed  ·  Nivel de riesgo (10.4): corte 1 funcionalidad mediana; corte 2 bajo (solo app, sin backend ni deploy)

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

## Alcance
- Incluido (corte 1): inicio y cierre de sesión con usuario precreado; catálogo único; carrito en
  el dispositivo; confirmación de pedido con precio calculado en servidor; lista y detalle de
  mis pedidos con estado; script para que el distribuidor cambie el estado.
- Incluido (corte 2, solo app): barra superior ordenada con "Cerrar sesión" fuera de la barra
  (REQ-006); diseño visual consistente para una demo comercial (REQ-007); detalle de producto
  (REQ-008). Sin cambios de backend, contrato, infraestructura ni despliegue.
- Excluido explícitamente: auto-registro y recuperación de contraseña; pagos y facturación;
  control de stock; backoffice del distribuidor; notificaciones push y suscripciones en tiempo
  real; modo offline; varios distribuidores; listas de precios por cliente; imágenes, búsqueda y
  filtros del catálogo; editar o cancelar un pedido confirmado; publicación en tiendas.
- Cortes futuros: backoffice del distribuidor (Q-02), búsqueda/categorías, cancelación,
  notificaciones de cambio de estado, varios usuarios por almacén.

## Restricciones
- R-01 Stack: AWS Cognito, AppSync, Lambda, DynamoDB; cliente React Native — fuente: usuario
- R-02 Es una demo: un entorno `dev`, sin recursos de costo fijo (todo serverless/on-demand) — fuente: usuario (demo) · DEC-001, DEC-006
- R-03 Las decisiones técnicas las toma el agente y las registra sin preguntar — fuente: usuario, LOG 2026-10-17
- R-04 Despliegue `dev` con el perfil AWS `default` en `us-east-1` — fuente: usuario (Q-01), LOG 2026-10-17

## Glosario
- Almacenero: dueño o encargado de un almacén; cliente B2B del distribuidor; único actor de la app.
- Distribuidor: empresa que vende al almacenero y procesa los pedidos; en el corte 1 actúa por script.
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

### REQ-006 Barra superior ordenada · estado: proposed · prioridad: must · corte 2
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

### REQ-007 Diseño visual consistente · estado: proposed · prioridad: must · corte 2
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

### REQ-008 Detalle de producto · estado: proposed · prioridad: must · corte 2
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

## Preguntas abiertas
| ID | pregunta | clase | bloquea a | responsable | vence |
|---|---|---|---|---|---|
| Q-01 | ¿Qué cuenta/perfil AWS y región uso para desplegar `dev`? — **resuelta 2026-10-17**: perfil `default`, `us-east-1` (R-04) | bloqueante | — | usuario | — |
| Q-02 | ¿Quién y cómo cambia el estado del pedido en la operación real? | diferible | nada en corte 1 (script cubre la demo) | usuario | inicio del corte 2 |

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
- [ ] REQ-006..008 y S-15..S-21 aprobados por el responsable
- [ ] DEC-012 `accepted`
- [ ] Cada REQ con ≥1 ejemplo positivo y ≥1 negativo/borde (hecho en la propuesta)
- [ ] Sin preguntas bloqueantes (ninguna abierta)
