# Registro de decisiones (solo anexar; nunca editar una decisión aceptada)

Delegación: el usuario delegó las decisiones técnicas en el agente (R-03). Las DEC nacen `proposed`
y pasan a `accepted` cuando el usuario aprueba el corte con nombre en LOG.md.
DEC-001..007 aceptadas por José Pedro Lübbert el 2026-10-17 (LOG).

## DEC-001 Infraestructura como código con AWS CDK v2 en TypeScript
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert · Confianza: alta
- Problema: hay que crear y recrear Cognito, AppSync, Lambda y DynamoDB de forma reproducible, barata y legible por agentes, en el mismo lenguaje que el resto.
- Impulsores: R-01, R-02, T-01
- Alternativas consideradas:
  1. AWS CDK v2 (TS) — a favor: tipos, mismo lenguaje que app y backend, control total de AppSync y DynamoDB, pruebas de plantilla; en contra: bootstrap de cuenta, más código que Amplify.
  2. Amplify Gen 2 — a favor: muy rápido para Cognito+AppSync+RN; en contra: convenciones propias (modelo de datos y resolvers generados) que chocan con tabla única y resolvers Lambda; más magia para el agente.
  3. SAM / CloudFormation YAML — a favor: sin dependencias; en contra: sin tipos, verboso para AppSync.
  4. Terraform — a favor: estándar multi-nube; en contra: otro lenguaje y estado remoto que gestionar.
- Decisión: Usaremos CDK v2 en TypeScript con una pila `PedidosB2B-<stage>` (stage `dev`, región por contexto, por defecto `us-east-1`) y no Amplify Gen 2, para tener control explícito y revisable, aceptando más código de infraestructura.
- Consecuencias: buenas: `cdk synth` verificable sin cuenta; malas: requiere `cdk bootstrap` en la cuenta de R-04; neutrales: en `dev` los recursos usan `RemovalPolicy.DESTROY`.
- Dependencias: afecta a DEC-004, DEC-005, DEC-006 · contrato spec/contracts/schema.graphql
- Evidencia: documentación de CDK y Amplify Gen 2; ninguna medición propia.
- Confirmación: `npm run synth` y prueba de plantilla (`infra/test`) en `npm test`.
- Revisar si: se necesita hosting/CI de Amplify, varias cuentas o el equipo prefiere Terraform.

## DEC-002 Monorepo TypeScript con npm workspaces
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert · Confianza: media
- Problema: app, backend e infraestructura comparten tipos del contrato y deben evolucionar juntos en un solo historial.
- Impulsores: R-01, principio "un solo escritor", T-01
- Alternativas consideradas:
  1. npm workspaces (`app`, `backend`, `infra`) — a favor: sin herramientas extra, compatible con Metro/Expo; en contra: instalaciones más lentas.
  2. pnpm + Turborepo — a favor: velocidad y caché; en contra: los enlaces simbólicos de pnpm requieren configuración extra en Metro.
  3. Repos separados — a favor: aislamiento; en contra: contrato duplicado y cambios cruzados en varios repos.
- Decisión: Usaremos un monorepo con npm workspaces, TypeScript estricto y Node.js 24 LTS, y no pnpm/Turborepo, para minimizar fricción con Expo, aceptando instalaciones más lentas.
- Consecuencias: buenas: un `npm ci` prepara todo; malas: sin caché de tareas; neutrales: tipos de GraphQL generados desde el contrato en `backend` y `app`.
- Dependencias: depende de DEC-001, DEC-003
- Evidencia: documentación de Expo sobre monorepos.
- Confirmación: `npm ci && npm run typecheck` desde la raíz.
- Revisar si: los tiempos de CI superan 10 min o se suman paquetes.

## DEC-003 App React Native con Expo y aws-amplify v6 como librería cliente
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert · Confianza: media
- Problema: la app debe autenticarse contra Cognito y consumir AppSync en iOS/Android con la menor configuración nativa posible, para una demo en teléfono.
- Impulsores: R-01, REQ-001, REQ-005, criterio de éxito (demo en teléfono)
- Alternativas consideradas:
  1. Expo (SDK estable fijado en T-01, Expo Router) + `aws-amplify` v6 (Auth + cliente GraphQL), sin Amplify CLI — a favor: SRP, almacenamiento seguro de tokens y firmado listos; en contra: dependencia de un SDK grande; posible necesidad de development build.
  2. Expo + `amazon-cognito-identity-js` + Apollo/urql — a favor: piezas pequeñas; en contra: más código propio de sesión y refresco de tokens.
  3. React Native CLI sin Expo — a favor: control nativo total; en contra: más configuración y peor ciclo de demo.
- Decisión: Usaremos Expo con TypeScript y `aws-amplify` v6 solo como librería cliente, y no RN CLI ni clientes armados a mano, para tener login y sesión persistente con poco código, aceptando el peso del SDK.
- Consecuencias: buenas: REQ-001 E3 y REQ-005 casi gratis; malas: si Expo Go no basta, la demo requiere development build; neutrales: la UI de login es propia (no Authenticator).
- Dependencias: depende de DEC-004 · afecta a REQ-001, REQ-005
- Evidencia: documentación de Amplify v6 para React Native; compatibilidad con Expo Go sin verificar (spike en T-01).
- Confirmación: prueba de humo manual de T-01 (login desde teléfono) registrada en LOG.
- Revisar si: el spike de T-01 muestra incompatibilidad que no se resuelve con development build.

## DEC-004 Identidad con Cognito User Pool y cliente derivado del token
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert · Confianza: alta
- Problema: hay que identificar al almacenero y aislar sus pedidos; la clave de partición de los pedidos depende de esta identidad (costoso de revertir).
- Impulsores: REQ-001, REQ-004 E3, S-01, R-01
- Alternativas consideradas:
  1. User Pool con correo+contraseña (SRP), sin auto-registro, grupo `almaceneros`, atributo `custom:customerId`; AppSync en modo `AMAZON_COGNITO_USER_POOLS` — a favor: aislamiento por token, multiusuario por almacén aditivo; en contra: alta de usuarios por script.
  2. Igual pero clave = `sub` del usuario — a favor: sin atributo extra; en contra: ata el pedido a la persona, no al almacén; migración si hay varios usuarios por almacén.
  3. Hosted UI / OAuth — a favor: flujos estándar; en contra: redirecciones y deep links en móvil, innecesario para la demo.
- Decisión: Usaremos la alternativa 1: el `customerId` sale siempre del claim `custom:customerId` del token y nunca de la entrada del cliente, y no `sub`, para que varios usuarios por almacén sean un cambio aditivo, aceptando mantener un atributo personalizado.
- Consecuencias: buenas: aislamiento verificable; malas: el seed debe fijar el atributo; neutrales: usuarios fuera del grupo `almaceneros` reciben `Unauthorized`.
- Dependencias: depende de DEC-001 · afecta a REQ-001, REQ-003, REQ-004, DEC-006
- Evidencia: documentación de Cognito y AppSync (autorización por user pool).
- Confirmación: tests/acceptance/req_004_* E3 (pedido ajeno no visible) y req_001_* E4 (sin token).
- Revisar si: se exige SSO, auto-registro o login por teléfono.

## DEC-005 API AppSync GraphQL con un resolver Lambda en TypeScript
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert · Confianza: media
- Problema: la confirmación de pedidos requiere validación y cálculo de precios en servidor; el contrato es consumido por la app.
- Impulsores: REQ-003 (E2–E4), R-01
- Alternativas consideradas:
  1. Una Lambda `api` (Node.js 24, TS, esbuild) como fuente de datos de todos los campos, enrutando por `fieldName`; dominio puro probado con Vitest — a favor: un solo estilo, lógica testeable local; en contra: arranque en frío, una función con varios permisos.
  2. Resolvers APPSYNC_JS directos a DynamoDB para lecturas + Lambda solo para `createOrder` — a favor: lecturas más rápidas y baratas; en contra: dos estilos de lógica y de prueba.
  3. Una Lambda por operación — a favor: permisos mínimos por función; en contra: más recursos y despliegues para una demo.
- Decisión: Usaremos la alternativa 1 con el contrato en `spec/contracts/schema.graphql` y errores de negocio como `errorType` (`INVALID_QUANTITY`, `PRODUCT_UNAVAILABLE`, `EMPTY_ORDER`, `TOO_MANY_LINES`; la fusión de líneas repetidas ocurre en el dominio antes de validar), y no resolvers mixtos, para tener una sola forma de probar, aceptando el arranque en frío.
- Consecuencias: buenas: REQ-003 se prueba sin AWS; malas: latencia inicial (medida en T-01); neutrales: pasar lecturas a APPSYNC_JS después es local al resolver.
- Dependencias: depende de DEC-001, DEC-004 · afecta a REQ-002..004, contrato spec/contracts/schema.graphql
- Evidencia: documentación de AppSync (resolvers Lambda directos).
- Confirmación: la infra carga el esquema desde `spec/contracts/`; prueba de plantilla verifica que todos los campos usan la fuente `api`.
- Revisar si: la primera respuesta supera 3 s o el costo de Lambda importa.

## DEC-006 Persistencia en una tabla DynamoDB on-demand con montos enteros en CLP
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert · Confianza: media
- Problema: el modelo persistido de productos y pedidos es costoso de cambiar después; debe permitir "mis pedidos" ordenados por fecha y aislamiento por cliente.
- Impulsores: REQ-002, REQ-003, REQ-004, R-02, S-02, DEC-004
- Alternativas consideradas:
  1. Tabla única `PK`/`SK` — Producto: `PK=CATALOG`, `SK=PRODUCT#<productId>`; Pedido: `PK=CUSTOMER#<customerId>`, `SK=ORDER#<ulid>`, líneas embebidas con nombre y precio congelados; montos enteros en pesos chilenos — a favor: una consulta por pantalla, orden por ULID; en contra: diseño menos intuitivo.
  2. Tablas `Products` y `Orders` — a favor: simple de leer; en contra: más recursos; igual hay que diseñar claves.
  3. Líneas como ítems separados — a favor: pedidos enormes; en contra: escrituras transaccionales para algo acotado a 50 líneas (S-03).
- Decisión: Usaremos la alternativa 1 en modo on-demand, IDs ULID y montos `Int` en pesos CLP (moneda sin decimales; no se usan centavos ni flotantes), y no tablas separadas, para servir cada pantalla con una consulta, aceptando una partición `CATALOG` caliente.
- Consecuencias: buenas: `myOrders` = `Query PK, ScanIndexForward=false`; malas: catálogo en una partición; neutrales: una futura vista del distribuidor añade un GSI por estado (aditivo).
- Dependencias: depende de DEC-004 · afecta a REQ-002..004
- Evidencia: guías de diseño de DynamoDB de AWS; CLP es moneda de 0 decimales (ISO 4217).
- Nota: antes de aceptarse, cambió de "centavos ARS" a "pesos CLP enteros" por corrección del usuario a S-02 (LOG 2026-10-17).
- Confirmación: pruebas unitarias del repositorio de datos y req_004_* E1 (orden) y E5 (precio congelado).
- Revisar si: el catálogo supera 1.000 productos, se necesita búsqueda o vista del distribuidor, o se opera en una moneda con decimales.

## DEC-007 Estrategia de pruebas: aceptación contra `dev` real
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert · Confianza: media
- Problema: los ejemplos de REQ deben ser ejecutables, y la autorización Cognito/AppSync se comporta distinto en emuladores.
- Impulsores: principio 5, REQ-001..004
- Alternativas consideradas:
  1. Vitest: unitarias de dominio y plantilla CDK; aceptación en `tests/acceptance/` contra la API desplegada en `dev` con usuarios `almacen1`/`almacen2`; componentes con jest-expo + Testing Library; recorrido completo en el teléfono, manual y registrado — a favor: fidelidad de auth real; en contra: requiere despliegue (R-04).
  2. Emulación local (simulador de AppSync, LocalStack) — a favor: sin cuenta; en contra: diferencias en autorización.
  3. E2E en dispositivo (Maestro/Detox) desde el corte 1 — a favor: cubre UI; en contra: costo alto para una demo.
- Decisión: Usaremos la alternativa 1, y no emulación ni E2E en dispositivo en el corte 1, para probar la autorización real, aceptando que la aceptación de UI sea manual y registrada en LOG: REQ-001 E1–E3, REQ-002 E3, REQ-003 E5 y subtotal por línea, REQ-004 E4, REQ-005, y el recorrido del criterio de éxito.
- Consecuencias: buenas: los ejemplos de API son pruebas reales; malas: sin red/AWS no hay aceptación; neutrales: Maestro queda como opción de corte 2.
- Dependencias: depende de DEC-001, DEC-004, DEC-005
- Evidencia: documentación de AppSync/Cognito; ninguna medición propia.
- Confirmación: `npm run test:acceptance` registrado como `evidence` en TASKS.json.
- Revisar si: aparecen regresiones de UI no detectadas o se automatiza la demo.

## DEC-008 Expo SDK 57 mientras Expo Go de la Play Store no soporte SDK 58
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert · Confianza: alta
- Problema: el SDK fijado en T-01 (58, el `latest` de npm) no abre en el Expo Go que instala la Play Store del teléfono del usuario: "Project is incompatible with this version of Expo Go". Ese Expo Go soporta SDK 57 (confirmado por el usuario). La versión de Expo Go en las tiendas puede quedar atrás cuando sale un SDK nuevo.
- Impulsores: DEC-003 (SDK estable fijado en T-01), T-01 (login manual desde el teléfono), REQ-001
- Alternativas consideradas:
  1. Bajar el proyecto a SDK 57 (`expo ~57.0.30` + `npx expo install --fix`; React 19.2.3, RN 0.86.3) — a favor: funciona con el Expo Go de la tienda sin tocar el teléfono; en contra: hay que volver a subir cuando la tienda publique Expo Go 58.
  2. Seguir en SDK 58 e instalar a mano el APK oficial de Expo Go 58.0.4 — a favor: sin cambios en el repo; en contra: hay que instalar desde fuera de la tienda en cada teléfono de la demo.
  3. Development build (`expo run:android`) — a favor: no depende de Expo Go; en contra: requiere toolchain nativo y `android.package`; queda reservada para el spike de `AmplifyRTNCore`.
- Decisión: Usaremos la alternativa 1 (SDK 57) y no la 2 ni la 3, para que la demo abra con el Expo Go de la Play Store, aceptando un salto a SDK 58 posterior.
- Consecuencias: buenas: `expo-doctor` 21/21 y bundle Android ok; malas: queda `react-native-worklets@0.13.0` fuera del rango del peer opcional de `expo-modules-core@57` (la app no la usa, viene transitiva de expo-router); neutrales: la `override` de `react` en el `package.json` raíz pasa a 19.2.3 y `package-lock.json` se regeneró.
- Dependencias: refina DEC-003 (no la supersede: sigue siendo Expo + aws-amplify v6)
- Evidencia: `api.expo.dev/v2/versions/latest` (SDK 57 → Expo Go 57.0.9; SDK 58 → 58.0.4); el manifiesto servido por Metro decía `sdkVersion 58.0.0` antes del cambio y `57.0.0` después; Expo Go 57.0.9 en emulador Android 35 abre la app en la pantalla "Iniciar sesión".
- Confirmación: `cd app && npx expo-doctor && npx expo install --check`.
- Revisar si: la Play Store publica Expo Go para SDK 58 (subir con `npx expo install expo@^58 && npx expo install --fix`).

## DEC-009 Forma de la API de pedidos en el contrato
- Estado: proposed
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: — (propuesta por el agente, R-03) · Confianza: media
- Problema: las pruebas de aceptación de REQ-003 y REQ-004 (T-03) se escriben antes de que el contrato tenga pedidos; app, backend y pruebas deben coincidir en nombres de campos, en cómo llega el `productId` de `PRODUCT_UNAVAILABLE` y en cómo se invoca el script del distribuidor.
- Impulsores: REQ-003, REQ-004, S-02, S-04, S-11, DEC-005, DEC-006, T-03
- Alternativas consideradas:
  1. Fijar ahora la forma (abajo) y que T-04..T-06 la agreguen a `spec/contracts/schema.graphql` al implementar cada operación — a favor: el contrato desplegado no declara campos sin resolver; en contra: hasta entonces la forma vive aquí y en las pruebas.
  2. Agregar ya todo al contrato en T-03 — a favor: una sola fuente desde hoy; en contra: T-03 (spec) pasaría a cambiar infra y tipos generados, y la API desplegada tendría campos que fallan con "Campo sin resolver".
  3. `productId` de `PRODUCT_UNAVAILABLE` en `errorInfo` — a favor: estructurado; en contra: con resolvers Lambda directos AppSync solo expone `errorType` y `message` sin plantilla de respuesta extra.
- Decisión: Usaremos la alternativa 1 con esta forma:
  - `enum OrderStatus { RECIBIDO EN_PREPARACION ENVIADO ENTREGADO CANCELADO }` (S-04)
  - `type Order { id: ID! number: String! createdAt: AWSDateTime! total: Int! status: OrderStatus! lines: [OrderLine!]! }` — `id` = ULID (DEC-006), `number` = últimos 8 caracteres del ULID en mayúsculas (S-11)
  - `type OrderLine { productId: ID! name: String! presentation: String! quantity: Int! unitPrice: Int! subtotal: Int! }` — nombre, presentación y precio congelados al confirmar; montos en CLP (S-02)
  - `input OrderLineInput { productId: ID! quantity: Int! }` dentro de `input CreateOrderInput { lines: [OrderLineInput!]! }` — sin campo de precio (S-12)
  - `Query.myOrders: [Order!]!` (más reciente primero), `Query.order(id: ID!): Order` (`null` si no existe o es de otro cliente), `Mutation.createOrder(input: CreateOrderInput!): Order!`
  - Errores de negocio como `errorType` (DEC-005); en `PRODUCT_UNAVAILABLE` el `message` contiene el `productId`.
  - Script del distribuidor: `npm run order:set-status -- <id> <estado>` con el `id` del pedido; sale con código ≠ 0 si el estado no es de S-04 o el pedido no existe.
  No usaremos la alternativa 2 ni la 3, para que el contrato desplegado solo declare lo implementado, aceptando que la forma viva aquí hasta T-06.
- Consecuencias: buenas: T-03 escribe pruebas ejecutables sin tocar infra; malas: dos lugares hasta que T-04..T-06 la pasen al contrato; neutrales: el script busca el pedido solo por `id` (sin `customerId`), lo que en la tabla de DEC-006 implica un Scan o un índice; para la demo basta el Scan.
- Dependencias: depende de DEC-004, DEC-005, DEC-006 · afecta a T-05, T-06, contrato spec/contracts/schema.graphql
- Evidencia: documentación de AppSync (resolvers Lambda directos: `errorType` y `message`).
- Confirmación: tests/acceptance/req_003_* y req_004_* pasan contra `dev`; el contrato al cierre de T-06 coincide con esta forma.
- Revisar si: la app necesita más campos del pedido o el distribuidor necesita otra forma de identificar pedidos.
