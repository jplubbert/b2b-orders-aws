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
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert (2026-10-17; propuesta por el agente, R-03) · Confianza: media
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

## DEC-010 Identidad AWS propia y acotada para el orquestador nocturno
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert (decisión del usuario en sesión) · Confianza: alta
- Problema: las pruebas de aceptación (DEC-007) y de humo corren contra `dev` y necesitan credenciales; el orquestador nocturno (T-08) las anulaba todas, así que T-03 no podía cerrar evidencia sin intervención. Pasarle el perfil `default` le daría permisos de administrador sobre la cuenta.
- Impulsores: DEC-007, R-04, T-03, T-08
- Alternativas consideradas:
  1. Usuario IAM `night-loop-tests` en la pila `PedidosB2B-dev` con permisos mínimos y perfil local `night-loop` — a favor: radio de daño acotado a los datos de `dev`; en contra: una llave de larga duración en ~/.aws/credentials.
  2. Pasar el perfil `default` y prohibir comandos por lista — a favor: sin infra; en contra: la lista de comandos no impide usar el SDK con credenciales de administrador.
- Decisión: Usaremos la alternativa 1. Usuario IAM `night-loop-tests` (solo en stage `dev`, sin login de consola, sin llaves en la plantilla) con: sobre la tabla, `dynamodb:GetItem/Query/Scan/PutItem/UpdateItem/DeleteItem/BatchWriteItem`; sobre el user pool, `cognito-idp:AdminCreateUser/AdminSetUserPassword/AdminAddUserToGroup/AdminDeleteUser/ListUsers`. `Scan` y `UpdateItem` los necesita `order:set-status` (DEC-009). La llave se crea fuera de CDK (`aws iam create-access-key`) y vive solo en el perfil local `night-loop`. `scripts/night-loop.sh` copia únicamente ese perfil a archivos temporales y apunta ahí `AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE`; `default` no existe para los procesos hijos. El implementador puede correr `npm run test:acceptance` y `npm run smoke`; deploy, bootstrap, seed, cdk y `aws` siguen denegados.
  No usaremos la alternativa 2, porque bloquear comandos no limita lo que permiten las credenciales.
- Consecuencias: buenas: el orquestador cierra evidencia de aceptación sin intervención; un error del agente solo puede tocar datos de `dev`. Malas: hay una llave de larga duración que rotar. Neutrales: el agente puede escribir en la tabla y en el user pool de `dev`; `npm run seed` lo restaura.
- Dependencias: depende de DEC-001, DEC-007 · afecta a T-08, infra/lib/pedidos-stack.ts
- Evidencia: `npm run deploy:dev` 2026-10-17 (usuario creado); con el perfil `night-loop`, `sts get-caller-identity` → `user/night-loop-tests`; `dynamodb list-tables`, `s3 ls` e `iam get-user-policy` → AccessDenied.
- Confirmación: infra/test/stack.test.ts (acciones exactas, sin `*`, sin AccessKey); scripts/test/night-tasks.test.ts (el hijo solo ve `[night-loop]`).
- Revisar si: hacen falta más servicios en las pruebas, o se pasa a credenciales temporales (rol asumido) para evitar la llave larga.

## DEC-011 Verificación manual en el teléfono diferida a la aceptación en lote
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-17 · Aprobador: José Pedro Lübbert (decisión del usuario en sesión) · Confianza: alta
- Problema: DEC-007 deja manual la aceptación de UI (REQ-002 E3, REQ-003 E5, REQ-004 E4, REQ-005…). Si una tarea solo espera esa verificación, queda `in_progress`: el orquestador nocturno (T-08) no la revisa, sus dependientes no avanzan y el implementador la repite sin cambios (corrida 2026-10-17_230411, T-04).
- Impulsores: DEC-007, T-04, T-08
- Alternativas consideradas:
  1. Pasar la tarea a `verified_auto` con la evidencia automática y diferir la verificación manual a la aceptación — a favor: la noche avanza y el usuario verifica varias tareas de una vez en el teléfono; en contra: `reviewed` ya no implica que la UI se vio funcionar.
  2. Dejarla `in_progress` hasta la verificación — a favor: el estado dice exactamente qué se probó; en contra: bloquea la cadena de tareas cada vez que hay UI.
- Decisión: Usaremos la alternativa 1. Cuando lo único pendiente del `verify` de una tarea es una verificación manual en el teléfono, el implementador registra la evidencia automática (`command`, `result`, `commit`) más `evidence.manual_pending` (qué verificar y cómo), pasa la tarea a `verified_auto` y anota la verificación en una línea `- Pendiente manual:` de su entrada de LOG.md. El resumen de cada corrida nocturna lista las pendientes de las tareas aún no aceptadas. El usuario las hace al aceptar en lote y registra el resultado en LOG.md; una tarea con verificación manual pendiente no pasa a `accepted` sin ese registro.
  No usaremos la alternativa 2, porque la verificación manual es del usuario y no debe frenar el trabajo automático.
- Consecuencias: buenas: la cadena de tareas no se detiene por la UI. Malas: un defecto visible solo en el teléfono se detecta al aceptar, quizá tras haber construido encima. Neutrales: la revisión independiente juzga solo lo automático.
- Dependencias: depende de DEC-007 · afecta a T-04..T-07, T-08 (scripts/night-loop.sh, scripts/lib/night-tasks.mjs)
- Evidencia: corrida nocturna 2026-10-17_230411 (dos intentos sobre T-04 sin cambios, ambos contados como fallo).
- Confirmación: scripts/test/night-tasks.test.ts (`manual-pending`; el resumen lista las pendientes).
- Revisar si: un defecto de UI aparece al aceptar y obliga a rehacer tareas dependientes.

## DEC-012 Tema propio de la app sin librerías de UI ni dependencias nuevas
- Estado: accepted
- Alcance: global (app)
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (aprobación del corte 2) · Confianza: alta
- Problema: REQ-007 pide colores, espaciado y tipografía consistentes; hoy cada pantalla define sus propios valores literales (`#1f6feb`, `#555`, `fontSize: 16`…). Hay que elegir dónde viven los valores y con qué se dibujan los componentes, sin tocar backend ni arriesgar la compatibilidad con Expo Go 57 (DEC-008).
- Impulsores: REQ-006, REQ-007, REQ-008, DEC-003, DEC-008
- Alternativas consideradas:
  1. Módulo `app/src/theme.ts` con tokens + componentes propios con `StyleSheet` de React Native — a favor: cero dependencias, funciona en Expo Go, verificable con una prueba que prohíbe literales fuera del tema; en contra: más componentes que escribir.
  2. Librería de UI (React Native Paper, Tamagui, NativeWind) — a favor: componentes hechos; en contra: dependencia y configuración nuevas, riesgo con SDK 57 y Expo Go, aspecto "de librería".
  3. Pestañas inferiores de Expo Router para la navegación — a favor: patrón conocido; en contra: requiere `@react-navigation/bottom-tabs` (no instalado) y cambia la estructura de rutas ya aceptada.
- Decisión: Usaremos la alternativa 1. Íconos como texto/Unicode o `View` dibujadas (sin paquete de íconos); menú de cuenta con `Modal` de React Native; tipografía del sistema.
  No usaremos la 2 ni la 3 porque agregan dependencias y riesgo sin beneficio visible en una demo de 3 minutos.
- Consecuencias: buenas: un solo lugar para cambiar la marca (S-16); sin cambios en `package.json`. Malas: componentes propios básicos. Neutrales: la pila de navegación se mantiene.
- Dependencias: depende de DEC-003, DEC-008 · afecta a T-09..T-12
- Confirmación: app/test/theme.test.tsx (sin literales de color ni `fontSize` numérico fuera de `theme.ts`; contraste ≥ 4,5:1 de los pares del tema); `git diff --stat` del corte sin cambios en `app/package.json`, `backend/`, `infra/`, `spec/contracts/`.
- Revisar si: el usuario trae una marca con componentes propios o se pide modo oscuro.

## DEC-013 Rol distribuidor: grupo Cognito, autorización por campo y acceso a todos los pedidos
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (2026-10-18, aprobación del corte 3; propuesta por el agente, R-03) · Confianza: media
- Problema: el corte 3 agrega un segundo actor que ve y modifica pedidos de todos los almacenes. Hay que decidir cómo se identifica, cómo se autoriza cada operación sin abrir los pedidos ajenos a un almacenero (DEC-004) y cómo se leen todos los pedidos de una tabla particionada por cliente (DEC-006).
- Impulsores: REQ-009, REQ-010, REQ-011, S-22, S-26, DEC-004, DEC-005, DEC-006, DEC-009
- Alternativas consideradas:
  1. Grupo `distribuidores` en el mismo user pool; `@aws_auth(cognito_groups)` por campo en el contrato y el rol verificado también en la Lambda; `allOrders` con Scan paginado; `setOrderStatus` recibe `customerId` + `id` y hace UpdateItem condicional directo — a favor: sin recursos nuevos ni migración de datos; el pedido ya guarda `customerId`; en contra: el Scan lee la tabla completa.
  2. Igual, pero `allOrders` sobre un GSI (`GSI1PK=ORDER`, `GSI1SK=<ulid>`, o uno por estado) — a favor: consulta ordenada y escalable (anticipado en DEC-006); en contra: hay que rellenar el índice en los pedidos existentes y, si la clave es el estado, mantenerla en cada cambio.
  3. Segundo user pool o segunda app para el distribuidor — a favor: separación total; en contra: duplica auth e infra y contradice "misma app".
- Decisión: Usaremos la alternativa 1, y no la 2, porque la demo tiene decenas de pedidos y el Scan no requiere migrar datos ya creados, aceptando revisar la decisión al superar 1.000 pedidos. `setOrderStatus` no busca por Scan (a diferencia del script de DEC-009) porque el panel ya conoce el `customerId` de cada pedido. Un pedido inexistente da `ORDER_NOT_FOUND` como `errorType` (DEC-005). El distribuidor no tiene `customerId`; las operaciones de almacenero lo siguen exigiendo.
- Consecuencias: buenas: cambio aditivo en contrato e infra; el aislamiento entre almaceneros (REQ-004 E3) no cambia. Malas: el Scan crece con la tabla; la Lambda gana `Scan` y `UpdateItem`. Neutrales: el script `order:set-status` sigue igual.
- Dependencias: depende de DEC-004, DEC-005, DEC-006, DEC-009 · afecta a T-13..T-16, contrato spec/contracts/schema.graphql, infra/lib/pedidos-stack.ts
- Evidencia: documentación de AppSync (`@aws_auth` con `cognito_groups` por campo en modo user pool).
- Confirmación: tests/acceptance/req_009_* (E5, E6), req_010_*, req_011_* contra `dev`; req_001..004 siguen pasando.
- Revisar si: hay más de 1.000 pedidos, varios distribuidores o se piden reglas de transición de estado.


## DEC-014 `dev` en una cuenta AWS propia del demo, con rol asumido desde `default`
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (Pepe), 2026-10-18 (decisión del usuario en sesión, tras el dry-run del autopilot) · Confianza: alta
- Problema: `dev` vivía en la cuenta principal del usuario ([REDACTED_AWS_ACCOUNT_MAIN]) con el perfil `default` (usuario IAM `[REDACTED_IAM_USER]`, administrador). El demo comparte cuenta, costos y radio de daño con todo lo demás del usuario. El usuario creó una cuenta miembro de su organización solo para el demo ([REDACTED_AWS_ACCOUNT_DEMO]) y pidió moverlo ahí. Cambia R-04.
- Impulsores: R-02, R-04, DEC-001, DEC-010
- Alternativas consideradas:
  1. Perfil `pedidos-demo` que asume `OrganizationAccountAccessRole` en [REDACTED_AWS_ACCOUNT_DEMO] con `source_profile = default` — a favor: sin llaves nuevas de larga duración; credenciales temporales; costos y recursos aislados; en contra: el rol es administrador de la cuenta miembro.
  2. Usuario IAM con llave propia en la cuenta nueva — a favor: no depende de `default`; en contra: otra llave larga que rotar.
  3. Seguir en la cuenta principal — a favor: nada que mover; en contra: no separa el demo, que es lo pedido.
- Decisión: Usaremos la alternativa 1. `bootstrap:dev` y `deploy:dev` fijan `AWS_PROFILE=pedidos-demo`; `seed`, `order:set-status`, `smoke` y `test:acceptance` usan `${AWS_PROFILE:-pedidos-demo}`, así un `AWS_PROFILE` explícito (p. ej. `night-loop` en el autopilot, DEC-010) sigue mandando. Región `us-east-1` sin cambios. La pila `PedidosB2B-dev` y `CDKToolkit` de [REDACTED_AWS_ACCOUNT_MAIN] se conservan hasta que el usuario decida borrarlas.
  No usaremos la 2 porque agrega una llave larga sin necesidad; ni la 3 porque contradice el pedido.
- Consecuencias: buenas: el demo queda aislado; su costo se ve por cuenta. Malas: durante la transición hay dos pilas `PedidosB2B-dev` (la vieja ya no la usan `.env.dev` ni las pruebas); usuarios, contraseña y pedidos de la cuenta vieja no se migran (el seed recrea catálogo y usuarios, conserva `DEMO_PASSWORD`). Neutrales: el usuario `night-loop-tests` (DEC-010) existe en las dos cuentas; el perfil local `night-loop` usa la llave de la cuenta nueva y la de la cuenta principal queda `Inactive` (no borrada), así el autopilot no puede tocar la cuenta principal. `scripts/autopilot.sh` no cambia.
- Dependencias: depende de DEC-001, DEC-010 · afecta a R-04, package.json, ~/.aws/config y ~/.aws/credentials (fuera de git), T-18
- Evidencia: 2026-10-18, `aws sts get-caller-identity --profile pedidos-demo` → `assumed-role/OrganizationAccountAccessRole/pedidos-demo` en [REDACTED_AWS_ACCOUNT_DEMO]; `npm run bootstrap:dev` → aws://[REDACTED_AWS_ACCOUNT_DEMO]/us-east-1 bootstrapped; `npm run deploy:dev` → PedidosB2B-dev creada + seed; `npm run smoke` 2/2; `npm run test:acceptance` 41/41. Autopilot: llave nueva de `night-loop-tests` en [REDACTED_AWS_ACCOUNT_DEMO] en `[night-loop]`; `sts get-caller-identity --profile night-loop` → `arn:aws:iam::[REDACTED_AWS_ACCOUNT_DEMO]:user/night-loop-tests`; `dynamodb list-tables`, `s3 ls`, `iam get-user-policy` → AccessDenied; llave anterior ([REDACTED_AWS_ACCOUNT_MAIN]) → `Inactive`; `AWS_PROFILE=night-loop npm run smoke` 2/2; `scripts/autopilot.sh --dry-run` ok (guardas: `AWS_PROFILE=night-loop`, llave de la cuenta nueva).
- Confirmación: `npm run smoke` y `npm run test:acceptance` sin `AWS_PROFILE` pasan contra la cuenta nueva.
- Revisar si: el usuario borra la cuenta principal del demo, o se quiere un rol con menos permisos que `OrganizationAccountAccessRole`.

## DEC-015 Identidad del autopilot: perfil `autopilot` y usuario IAM `autopilot-tests` (supersede los nombres de DEC-010)
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (Pepe), 2026-10-18 (decisión del usuario en sesión) · Confianza: alta
- Problema: el orquestador se renombró de night-loop a autopilot (LOG 2026-10-18, T-08), pero la identidad AWS de DEC-010 seguía con los nombres viejos (perfil `night-loop`, usuario `night-loop-tests`, id lógico `NightLoopTestsUser`) porque DEC-010 está `accepted` y no se edita. El usuario pidió el renombre.
- Impulsores: DEC-010, DEC-014, T-08
- Alternativas consideradas:
  1. Supersedir solo los nombres: perfil local `autopilot`, usuario IAM `autopilot-tests` (id lógico `AutopilotTestsUser`); mismos permisos, mismas guardas, misma cuenta (DEC-014) — a favor: nombres coherentes con `scripts/autopilot.sh`; en contra: reemplazar el usuario obliga a crear una llave nueva.
  2. Dejar los nombres viejos — a favor: nada que cambiar; en contra: lo contrario a lo pedido.
- Decisión: Usaremos la alternativa 1. Todo lo demás de DEC-010 sigue vigente (acciones exactas sobre la tabla y el user pool, sin llaves en la plantilla, llave creada con `aws iam create-access-key`, solo ese perfil para los hijos del autopilot). Donde DEC-010 dice `night-loop` / `night-loop-tests` se lee `autopilot` / `autopilot-tests`. Migración sin hueco: despliegue con ambos usuarios, llave nueva, llave vieja `Inactive`, verificación, borrado de la llave vieja y despliegue final sin el usuario viejo.
- Consecuencias: buenas: un solo nombre para el orquestador en código, infra y ~/.aws. Malas: ninguna relevante. Neutrales: las entradas anteriores de LOG.md y TASKS.json siguen diciendo `night-loop` (solo anexar).
- Dependencias: supersede los nombres de DEC-010 · depende de DEC-010, DEC-014 · afecta a infra/lib/pedidos-stack.ts, infra/test/stack.test.ts, scripts/autopilot.sh, scripts/test/autopilot-tasks.test.ts, AGENTS.md, ~/.aws/config y ~/.aws/credentials (fuera de git), T-20
- Evidencia: 2026-10-18, en [REDACTED_AWS_ACCOUNT_DEMO]: `sts get-caller-identity --profile autopilot` → `arn:aws:iam::[REDACTED_AWS_ACCOUNT_DEMO]:user/autopilot-tests`; `dynamodb list-tables`, `s3 ls`, `iam get-user-policy` → AccessDenied; `AWS_PROFILE=autopilot npm run smoke` 2/2; `scripts/autopilot.sh --dry-run` ok (guardas: `AWS_PROFILE=autopilot`, llave [REDACTED_ACCESS_KEY_ID_3]); llave vieja [REDACTED_ACCESS_KEY_ID_4] Inactive → borrada; usuario `night-loop-tests` → NoSuchEntity tras el despliegue final.
- Confirmación: infra/test/stack.test.ts (`autopilot-tests`, acciones exactas, sin AccessKey); scripts/test/autopilot-tasks.test.ts (el hijo solo ve `[autopilot]`).
- Revisar si: se pasa a credenciales temporales (rol asumido) en lugar de la llave larga.

## DEC-016 Avisos del autopilot por ntfy.sh, con el tema fuera del repo
- Estado: accepted
- Alcance: global (tooling)
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (Pepe), 2026-10-18 (decisión del usuario en sesión) · Confianza: alta
- Problema: el autopilot corre de noche sin supervisión; el usuario solo se entera del resultado al abrir LOG.md. Pidió un aviso push al detenerse, con más urgencia si hace falta que intervenga. ntfy.sh es un servicio externo fuera de R-01 (R-01 es el stack del producto; esto es tooling del protocolo, pedido expresamente por el usuario).
- Impulsores: T-08, T-21
- Alternativas consideradas:
  1. POST a `https://ntfy.sh/$NTFY_TOPIC` con `curl` desde el orquestador (no desde el implementador) — a favor: sin cuenta ni llaves, app móvil gratuita, prioridad y tags nativos; en contra: el tema es la única protección (quien lo conoce lee los avisos) y los mensajes pasan por un servidor público.
  2. Correo o Slack — a favor: canales conocidos; en contra: credenciales, más configuración y sin prioridad push.
- Decisión: Usaremos la alternativa 1. `NTFY_TOPIC` (y opcionalmente `NTFY_URL`) se leen de `AUTOPILOT_CONFIG` (por defecto `~/.config/autopilot/autopilot.config.sh`, fuera de git; `autopilot.config.sh` además en `.gitignore`); no se exportan a los procesos hijos ni se escriben en LOG.md ni en los registros. El mensaje lleva motivo de parada, tareas hechas/fallidas y próxima acción (también el aviso de caída); esos campos van primero y solo el detalle de lo hecho se recorta para que el mensaje no pase de `AUTOPILOT_NTFY_MAX` (3000) caracteres; no lleva diffs, código ni credenciales. Prioridad `high` + tags `warning,rotating_light` si la parada requiere intervención (código 1, tarea bloqueada o abandonada, rechazo del revisor, límite de presupuesto, despliegue o aprobación pendiente, caída antes del resumen); `default` + `white_check_mark` si terminó bien. `curl --max-time 15`; si falla, solo se anota en el registro de la corrida y el resultado de la corrida no cambia. En `--dry-run` se muestra el aviso sin enviarlo.
  No usaremos la alternativa 2 porque exige credenciales y no distingue urgencia en el teléfono.
- Consecuencias: buenas: el usuario sabe al despertar si debe intervenir. Malas: dependencia de un servicio público (si cae, no hay aviso; LOG.md sigue siendo la fuente). Neutrales: el implementador sigue sin red (`curl` denegado).
- Dependencias: depende de DEC-010 (guardas de los hijos) · afecta a scripts/autopilot.sh, scripts/test/autopilot-tasks.test.ts, AGENTS.md, .gitignore, T-21
- Confirmación: scripts/test/autopilot-tasks.test.ts (`aviso ntfy al detenerse (T-21)`, con doble de curl; ninguna prueba lee la configuración real).
- Revisar si: los avisos necesitan más detalle, o se quiere un servidor ntfy propio o autenticado.

## DEC-017 Acceso humano a AWS con IAM Identity Center (supersede el mecanismo de DEC-014)
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (Pepe), 2026-10-18 (decisión del usuario en sesión) · Confianza: alta
- Problema: DEC-014 da acceso a [REDACTED_AWS_ACCOUNT_DEMO] asumiendo `OrganizationAccountAccessRole` desde `default`, que es el usuario IAM `[REDACTED_IAM_USER]` con `AdministratorAccess`, sin MFA y con una llave de larga duración en ~/.aws/credentials: quien lea ese archivo es administrador de la organización. El usuario pidió reemplazarla por credenciales temporales.
- Impulsores: R-04, DEC-014
- Alternativas consideradas:
  1. IAM Identity Center (instancia de organización en us-east-1, directorio propio), usuario con MFA, permission set `AdministratorAccess` de 8 h asignado a las dos cuentas; perfiles `principal` y `pedidos-demo` con un `sso-session` común — a favor: sin llaves largas; MFA en cada login; un acceso para las dos cuentas; en contra: `aws sso login` cada 8 h.
  2. Mantener `[REDACTED_IAM_USER]` con MFA obligatorio para asumir el rol (`aws sts get-session-token`) — a favor: sin servicio nuevo; en contra: la llave larga sigue en disco.
- Decisión: Usaremos la alternativa 1. `pedidos-demo` conserva el nombre (los scripts no cambian) pero entra por SSO directo a [REDACTED_AWS_ACCOUNT_DEMO], sin `source_profile` ni `OrganizationAccountAccessRole`; `principal` es la cuenta de administración. `[default]` queda sin credenciales cuando se retire la llave de `[REDACTED_IAM_USER]`. No cambia el perfil `autopilot` (DEC-010/DEC-015). La llave de `[REDACTED_IAM_USER]` se desactiva primero y solo se borra, con el usuario, tras un período de prueba y confirmación aparte.
  No usaremos la 2 porque deja la llave larga en disco.
- Consecuencias: buenas: ninguna credencial de administrador de larga duración en la máquina; MFA obligatorio. Malas: hay que repetir `aws sso login --sso-session pepe` al vencer la sesión (8 h) para desplegar o administrar. Neutrales: acceso de emergencia por el root de [REDACTED_AWS_ACCOUNT_MAIN] (con MFA), que no puede asumir roles.
- Dependencias: supersede el mecanismo de acceso de DEC-014 (la cuenta y la región siguen) · depende de DEC-014 · afecta a R-04, ~/.aws/config y ~/.aws/credentials (fuera de git), T-22
- Evidencia: 2026-10-18, `sts get-caller-identity --profile principal` → `arn:aws:sts::[REDACTED_AWS_ACCOUNT_MAIN]:assumed-role/AWSReservedSSO_AdministratorAccess_[REDACTED]/pepe`; `--profile pedidos-demo` → `arn:aws:sts::[REDACTED_AWS_ACCOUNT_DEMO]:assumed-role/AWSReservedSSO_AdministratorAccess_[REDACTED]/pepe`; `cdk diff` con `pedidos-demo`: sin diferencias; `npm run smoke` 2/2; `npm run seed` ok.
- Confirmación: los mismos comandos con la llave de `[REDACTED_IAM_USER]` inactiva y fuera de ~/.aws/credentials (2026-10-18: `default` → NoCredentials; `principal` y `pedidos-demo` por SSO; `cdk diff` sin diferencias; smoke 2/2; seed ok; `autopilot` sin cambios, smoke 2/2 y `--dry-run` ok).
- Revisar si: se agregan personas (grupos y permission sets acotados) o se quiere un permission set de menos privilegio para el día a día.

## DEC-018 Idioma: código y commits en inglés; spec/ y LOG.md en español
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (Pepe), 2026-10-18 (decisión del usuario en sesión) · Confianza: alta
- Problema: el código, los comentarios, las pruebas, la salida de los scripts y los commits mezclan español e inglés. El usuario fijó una regla de idioma.
- Impulsores: pedido del usuario 2026-10-18
- Alternativas consideradas:
  1. Regla del usuario: inglés para código, identificadores, comentarios, pruebas, mensajes de scripts y commits; español para spec/ y LOG.md — a favor: el código queda legible para cualquier herramienta o persona; la spec sigue en el idioma del negocio.
- Decisión: Usaremos la alternativa 1, con estas interpretaciones: (a) los textos que ve el usuario de la app siguen en español (son requisitos de SPEC.md, p. ej. "Correo o contraseña incorrectos"), y las pruebas que los verifican conservan esas cadenas; (b) AGENTS.md y README.md siguen en español (no son código ni spec/); (c) las entradas de LOG.md que escribe el autopilot siguen en español, pero sus commits, su salida de terminal, sus registros y sus avisos ntfy pasan al inglés; (d) los commits ya hechos no se reescriben; (e) `tests/acceptance/` es protegida: su traducción (comentarios y nombres de prueba, nunca lo que verifican) va en una tarea `"kind": "spec"` aparte (T-24). Lo existente se traduce en T-23 y T-24 sin cambiar comportamiento: mismos códigos de salida, formatos de archivo, reglas de check:spec y trailers.
- Consecuencias: buenas: criterio único. Malas: una traducción grande (casi todos los archivos de código) que hay que verificar contra regresiones. Neutrales: el hook de commit no comprueba el idioma.
- Dependencias: afecta a AGENTS.md, todo el código, T-23, T-24 y sdd-base
- Confirmación: revisión de T-23 y T-24; `npm test`, aceptación y humo sin cambios de resultado.
- Revisar si: la app necesita otro idioma para el usuario final.

## DEC-019 Una Lambda por dominio detrás de AppSync (supersede DEC-005)
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (Pepe), 2026-10-18 (aprobación del corte 4; propuesta por el agente, R-03) · Confianza: alta
- Supersede a: DEC-005 (la Lambda única `api`); se mantienen el contrato en `spec/contracts/schema.graphql`, los errores de negocio como `errorType` y el dominio puro probado con Vitest.
- Problema: DEC-005 eligió una sola Lambda con todos los permisos y aceptó como contra la falta de permisos mínimos. El usuario pide alinear la demo a un stack objetivo con una función por dominio.
- Impulsores: encargo del corte 4; DEC-005 (alternativa 3 descartada entonces por costo de recursos); DEC-013 (la Lambda ganó Scan y UpdateItem para el panel)
- Alternativas consideradas:
  1. Tres Lambdas por dominio (`catalog`: `listProducts`; `orders`: `createOrder`, `myOrders`, `order`; `distributor`: `allOrders`, `setOrderStatus`), con el dominio compartido y un handler por dominio; cada campo de AppSync apunta a su Lambda — a favor: permisos mínimos y despliegue por dominio; en contra: tres arranques en frío y más recursos.
  2. Una Lambda por operación (6) — a favor: permisos aún más finos; en contra: más recursos sin beneficio visible para la demo.
  3. Mantener la Lambda única — en contra: contradice el encargo.
- Decisión: Usaremos la alternativa 1 (S-30). Al aprobar el corte 4, el usuario pidió mostrar el historial en el detalle del pedido: `orderHistory` va en `orders`. Permisos: `catalog` solo `GetItem`/`Query` sobre `CATALOG`; `orders` `PutItem`/`Query`/`GetItem` y lectura de catálogo, más `sns:Publish` al tópico de DEC-020; `distributor` `Scan`/`UpdateItem` y `sns:Publish`. El ruteo por `fieldName` queda dentro de cada handler. El contrato solo suma la consulta `orderHistory` de REQ-012 (S-29), que resuelve `orders` para los dos grupos con Query sobre `HISTORY#<orderId>`.
  No usaremos la 2 porque multiplica recursos sin cambiar la seguridad efectiva de una demo, ni la 3 porque contradice el encargo.
- Consecuencias: buenas: un error o permiso de un dominio no alcanza a los otros. Malas: tres arranques en frío. Neutrales: misma cantidad de despliegues (una pila).
- Dependencias: supersede DEC-005 · depende de DEC-001, DEC-004, DEC-006, DEC-013 · afecta a infra/lib/pedidos-stack.ts, backend/src, T-27
- Confirmación: infra/test (cada campo del contrato → la Lambda de su dominio; acciones IAM exactas por función, sin `*`); `npm run test:acceptance` completo sin cambios (REQ-012 E7).
- Revisar si: la primera respuesta supera 3 s (DEC-005) o aparece un dominio nuevo.

## DEC-020 Eventos de pedido asíncronos: SNS → SQS con DLQ → Lambda de historial
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (Pepe), 2026-10-18 (aprobación del corte 4; propuesta por el agente, R-03) · Confianza: media
- Problema: el encargo pide un flujo asíncrono: al crear o cambiar de estado un pedido, publicar en SNS, consumir con una cola SQS (con DLQ) y registrar el evento, por ejemplo el historial de estados (REQ-012). SNS y SQS están fuera de R-01: requieren ampliarla.
- Impulsores: REQ-012, R-01, R-02 (sin costo fijo: SNS y SQS se cobran por uso), DEC-006
- Alternativas consideradas:
  1. Publicar desde las Lambdas de pedidos y panel después de escribir en DynamoDB, en un tópico SNS estándar; cola SQS estándar suscrita con entrega cruda y DLQ; Lambda consumidora idempotente — a favor: es lo pedido; simple; en contra: si la publicación falla después de escribir, el evento se pierde (sin outbox).
  2. DynamoDB Streams → EventBridge Pipes → SNS/SQS (outbox implícito) — a favor: ningún evento se pierde; en contra: no publica "al crear o cambiar" desde la API como pide el encargo y agrega Streams y Pipes, fuera del stack pedido.
  3. SNS y SQS FIFO — a favor: orden estricto; en contra: deduplicación por grupo y límites de throughput sin necesidad para la demo.
- Decisión: Usaremos la alternativa 1. Mensajes `OrderCreated` y `OrderStatusChanged` con `eventId` (ULID), `orderId`, `customerId`, `from` (nulo al crear), `to` y `at` (momento fijado por quien publica, S-33). La publicación ocurre después de la escritura correcta; un rechazo de negocio no publica (REQ-012 E4); si la publicación falla, la operación igual responde bien y se registra el error en el log (S-32). Cola con DLQ: `maxReceiveCount` 3, retención de la DLQ 14 días, visibilidad 6× el timeout de la consumidora. Consumidora con fuente SQS en lotes y `ReportBatchItemFailures`; guarda cada evento con `PutItem` condicional (`attribute_not_exists`) en `PK=HISTORY#<orderId>`, `SK=EVENT#<at>#<eventId>`, en la tabla de DEC-006: fuera de la partición del cliente y del filtro `ORDER#` de los Scan del panel. La limpieza de la aceptación (T-19) borra también el historial de los clientes `C-ACEPT-…`. Lectura (pedida por el usuario al aprobar el corte 4, S-29): `Query.orderHistory(id)` devuelve `OrderStatusEvent` (`eventId`, `orderId`, `customerId`, `from` opcional, `to`, `at`) ordenados por `at` ascendente; un almacenero solo recibe los eventos con el `customerId` de su token (otro pedido → lista vacía), el distribuidor los de cualquier pedido.
  No usaremos la 2 porque no es el flujo pedido (queda como salida si se exige no perder eventos), ni la 3 porque la demo no necesita orden estricto.
- Consecuencias: buenas: el historial no agrega latencia al usuario; los fallos quedan apartados en la DLQ. Malas: un evento puede perderse si SNS falla justo después de la escritura; el historial llega con retraso (≤30 s según REQ-012). Neutrales: la aceptación lee el historial por la API (`orderHistory`), sin permisos nuevos para el usuario `autopilot-tests` (DEC-010).
- Dependencias: depende de DEC-006, DEC-019 · R-01 ampliada en el corte 4 · afecta a REQ-012, spec/contracts/schema.graphql, infra/lib/pedidos-stack.ts, backend/src, scripts/lib/acceptance-cleanup.ts, app (T-31), T-26, T-28
- Confirmación: tests/acceptance/req_012_* contra `dev` (incluida la lectura por `orderHistory` y su autorización, E8–E10); backend/test (idempotencia, sin publicación ante rechazo, error de publicación no rompe la respuesta); infra/test (suscripción cruda, DLQ con `maxReceiveCount` 3, permisos exactos de publicación y consumo).
- Revisar si: se exige no perder eventos (pasar a la alternativa 2) o se necesita orden estricto (alternativa 3).

## DEC-021 Estado del cliente con Zustand
- Estado: accepted
- Alcance: global (app)
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (Pepe), 2026-10-18 (aprobación del corte 4; propuesta por el agente, R-03) · Confianza: alta
- Problema: el carrito y la lista del panel viven en Context de React (`CartProvider`, `PanelProvider`) y la sesión en estado local de las pantallas. El encargo pide Zustand para el estado de la app.
- Impulsores: encargo del corte 4; DEC-003 (Amplify guarda los tokens); DEC-008 (Expo Go SDK 57); DEC-012 (sin dependencias nuevas en el corte 2, solo para el tema)
- Alternativas consideradas:
  1. Zustand: un store por área (`cart`, `session`, `panel`), sin persistencia (el carrito sigue solo en memoria, S-09) — a favor: JavaScript puro, compatible con Expo Go 57; menos código que los providers; se prueba sin renderizar; en contra: una dependencia nueva.
  2. Mantener Context — en contra: contradice el encargo.
- Decisión: Usaremos la alternativa 1 (S-31): la sesión guarda rol, correo, `customerId` y su estado de carga, y se hidrata desde `fetchAuthSession`; los tokens siguen en Amplify (DEC-003); cerrar sesión vacía el carrito y la lista del panel como hoy (REQ-005 E2). Se quitan `CartProvider` y `PanelProvider`. Pantallas, textos y flujos no cambian.
- Consecuencias: buenas: estado legible y testeable sin componentes. Malas: una dependencia más en app/package.json. Neutrales: ninguna pantalla cambia.
- Dependencias: depende de DEC-003, DEC-008 · R-01 ampliada en el corte 4 · afecta a app/src/lib, app/src/app, app/test, T-29
- Confirmación: app/test (jest) con las mismas expectativas de comportamiento y pruebas nuevas de los stores; `expo export` ok; verificación manual en el teléfono del guion del README (DEC-011).
- Revisar si: se pide conservar el carrito entre sesiones (persistencia de Zustand) o Expo Go deja de soportarlo.

## DEC-022 README técnico en inglés y CI en GitHub Actions (supersede la interpretación (b) de DEC-018 para README.md)
- Estado: accepted
- Alcance: global
- Fecha: 2026-10-18 · Aprobador: José Pedro Lübbert (Pepe), 2026-10-18 (aprobación del corte 4; propuesta por el agente, R-03) · Confianza: alta
- Supersede a: DEC-018 solo en su interpretación (b) para README.md (AGENTS.md sigue en español; el resto de DEC-018 sigue vigente).
- Problema: el usuario pide un README de presentación en inglés para un equipo técnico, con badges de CI. DEC-018 dejó README.md en español, y el repositorio no tiene CI.
- Impulsores: encargo del corte 4; DEC-018; DEC-007 (aceptación contra `dev` real)
- Alternativas consideradas:
  1. README.md en inglés; el resumen gerencial en español pasa a `docs/resumen-ejecutivo.md`; CI en GitHub Actions con lint, tipos, pruebas unitarias y check:spec, sin credenciales de AWS — a favor: lo pedido; CI sin secretos; en contra: el badge no cubre la aceptación contra AWS.
  2. Igual, con un rol OIDC de GitHub en la cuenta del demo para correr la aceptación en CI — a favor: el badge cubre todo; en contra: una identidad nueva con acceso a `dev` desde fuera de la máquina y otro recurso de IAM que mantener.
  3. Mantener el README en español — en contra: contradice el encargo.
- Decisión: Usaremos la alternativa 1 (S-34, S-35). El README dice explícitamente qué cubre el badge y dónde corre la aceptación contra AWS real.
  No usaremos la 2 todavía, porque agrega una identidad con acceso al entorno sin que el encargo lo pida (queda como salida); ni la 3.
- Consecuencias: buenas: entrada clara para el equipo técnico; CI sin secretos. Malas: dos documentos de presentación (técnico y gerencial) que mantener. Neutrales: minutos de GitHub Actions del repositorio privado.
- Dependencias: supersede DEC-018 (b) para README.md · afecta a README.md, docs/, .github/workflows/, T-30
- Confirmación: workflow en verde en GitHub; README revisado en la vista de GitHub (Mermaid dibujado, enlaces que resuelven).
- Revisar si: se pide la aceptación en CI (alternativa 2).
