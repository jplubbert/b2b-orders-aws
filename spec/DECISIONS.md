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
- Estado: proposed
- Alcance: global (tooling)
- Fecha: 2026-10-18 · Aprobador: pendiente (pedido por José Pedro Lübbert en sesión; falta su `accepted`) · Confianza: alta
- Problema: el autopilot corre de noche sin supervisión; el usuario solo se entera del resultado al abrir LOG.md. Pidió un aviso push al detenerse, con más urgencia si hace falta que intervenga. ntfy.sh es un servicio externo fuera de R-01 (R-01 es el stack del producto; esto es tooling del protocolo, pedido expresamente por el usuario).
- Impulsores: T-08, T-21
- Alternativas consideradas:
  1. POST a `https://ntfy.sh/$NTFY_TOPIC` con `curl` desde el orquestador (no desde el implementador) — a favor: sin cuenta ni llaves, app móvil gratuita, prioridad y tags nativos; en contra: el tema es la única protección (quien lo conoce lee los avisos) y los mensajes pasan por un servidor público.
  2. Correo o Slack — a favor: canales conocidos; en contra: credenciales, más configuración y sin prioridad push.
- Decisión: Usaremos la alternativa 1. `NTFY_TOPIC` (y opcionalmente `NTFY_URL`) se leen de `AUTOPILOT_CONFIG` (por defecto `~/.config/autopilot/autopilot.config.sh`, fuera de git; `autopilot.config.sh` además en `.gitignore`); no se exportan a los procesos hijos ni se escriben en LOG.md ni en los registros. El mensaje lleva motivo de parada, tareas hechas/fallidas y próxima acción; no lleva diffs, código ni credenciales. Prioridad `high` + tags `warning,rotating_light` si la parada requiere intervención (código 1, tarea bloqueada o abandonada, límite de presupuesto, despliegue o aprobación pendiente, caída antes del resumen); `default` + `white_check_mark` si terminó bien. `curl --max-time 15`; si falla, solo se anota en el registro de la corrida y el resultado de la corrida no cambia. En `--dry-run` se muestra el aviso sin enviarlo.
  No usaremos la alternativa 2 porque exige credenciales y no distingue urgencia en el teléfono.
- Consecuencias: buenas: el usuario sabe al despertar si debe intervenir. Malas: dependencia de un servicio público (si cae, no hay aviso; LOG.md sigue siendo la fuente). Neutrales: el implementador sigue sin red (`curl` denegado).
- Dependencias: depende de DEC-010 (guardas de los hijos) · afecta a scripts/autopilot.sh, scripts/test/autopilot-tasks.test.ts, AGENTS.md, .gitignore, T-21
- Confirmación: scripts/test/autopilot-tasks.test.ts (`aviso ntfy al detenerse (T-21)`, con doble de curl; ninguna prueba lee la configuración real).
- Revisar si: los avisos necesitan más detalle, o se quiere un servidor ntfy propio o autenticado.
