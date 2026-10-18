# Bitácora (solo anexar; una entrada por sesión)

## 2026-10-17 18:14 · Claude (claude-opus-5-5)
- Hecho: estructura PCR inicial a partir de ~/Projects/sdd-base/sdd.md §6 (variante desarrollador único: Plan dentro de SPEC.md). Creados AGENTS.md, spec/SPEC.md, spec/DECISIONS.md, spec/TASKS.json, spec/LOG.md. Sin código.
- Encargo del usuario: objetivo "Demo de pedidos B2B: el almacenero inicia sesión, ve el catálogo, arma un pedido y ve su estado"; stack AWS (Cognito, AppSync, Lambda, DynamoDB) + React Native; decisiones técnicas delegadas al agente (R-03); T-01 = esqueleto andante.
- Verificado y cómo: `node -e "JSON.parse(fs.readFileSync('spec/TASKS.json'))"` → JSON válido; `wc -l AGENTS.md` → ≤100 líneas.
- En curso / roto: nada. El repositorio aún no es git.
- Bloqueos nuevos: Q-01 cuenta/región AWS (bloquea evidencia de T-01; responsable: usuario).
- Decisiones: DEC-001..007 registradas como `proposed` (globales). Reglas de negocio no confirmadas quedan como supuestos S-01..S-11.
- Pendiente para cerrar el corte: confirmación de objetivo/exclusiones, aceptación de DEC-001..007, respuesta a Q-01, revisión independiente con contexto limpio.
- Próxima acción autorizada: el usuario revisa el resumen (punto de control 1). Con su aprobación: `git init`, DEC-001..007 → `accepted`, REQ-001..005 → `approved_for_impl`, T-01 y T-02 → `ready`, aprobación nominal en esta bitácora y commit inicial. Luego, T-01.

## 2026-10-17 18:40 · Claude (claude-opus-5-5)
- Hecho: correcciones del usuario y de la revisión independiente; aprobación del corte 1.
- Respuestas del usuario: S-02 → CLP, montos enteros en pesos sin decimales, formato `es-CL` (DEC-006 ajustada antes de aceptarse); Q-01 resuelta → perfil AWS `default`, región `us-east-1` (R-04).
- Revisión independiente (agente con contexto limpio): CON BLOQUEOS. (1) LOG no registraba Q-01 ni CLP → resuelto con esta entrada. (2) Regla de 50 líneas de REQ-003 sin ejemplo ni código → REQ-003 E7 + `TOO_MANY_LINES` en DEC-005. Observaciones no bloqueantes también aplicadas: fusión de líneas en servidor antes de validar (REQ-003, DEC-005); verificación manual de UI declarada en DEC-007 y en `verify` de T-04/T-05/T-06; criterio de éxito en `verify` de T-06. El usuario pidió no relanzar la revisión.
- Aprobación (punto de control 1): **José Pedro Lübbert**, 2026-10-17 — aprueba el corte 1 con estas correcciones. DEC-001..007 → `accepted`; REQ-001..005 → `approved_for_impl`; T-01, T-02 → `ready`; T-03..T-07 → `approved_for_impl` (esperan dependencias).
- Verificado y cómo: `node -e "JSON.parse(...)"` sobre spec/TASKS.json → válido.
- Bloqueos nuevos: ninguno.
- Próxima acción autorizada: T-01 Esqueleto andante (T-02 puede avanzar en paralelo).

## 2026-10-17 18:55 · Claude (claude-opus-5-5)
- Hecho: T-01 (código). Monorepo npm workspaces `app`/`backend`/`infra` (DEC-002); contrato mínimo `spec/contracts/schema.graphql` (`listProducts`, `@aws_auth` grupo `almaceneros`); pila CDK `PedidosB2B-dev` con user pool sin auto-registro + `custom:customerId` inmutable + grupo, tabla única on-demand, Lambda `api` Node.js 24 (esbuild, ESM) y AppSync que crea un resolver `api` por cada campo raíz leído del contrato (DEC-001, 004, 005, 006); `scripts/write-env.ts` (salidas CDK → `.env.dev`, genera `DEMO_PASSWORD`) y `scripts/seed.ts` (Yerba 1 kg $4.500, Arroz 1 kg $1.300; almacen1/almacen2 con `C-ALMACEN1`/`C-ALMACEN2`); app Expo SDK 58 + Expo Router (`app/src/app`) con login y lista de productos (DEC-003); prueba de humo `tests/smoke`. Nuevo comando `npm run bootstrap:dev` (CDK bootstrap, una vez por cuenta).
- Verificado y cómo (local, sin AWS): `npm ci` → ok; `npm run lint` → ok; `npm run typecheck` → ok; `npm test` → 14/14 (dominio, router, plantilla CDK); `npm run synth` → ok; `npx expo export --platform android` → bundle generado; `npx expo-doctor` → 20/20; `npm run smoke` sin `.env.dev` → falla con "Faltan … ejecuta `npm run deploy:dev`" (esperado).
- En curso / roto: T-01 `in_progress`. **Despliegue pendiente por instrucción del usuario: AWS CLI no instalado** (no se ejecutó `bootstrap:dev`, `deploy:dev` ni `smoke`). CDK no necesita la CLI en sí, pero sí credenciales del perfil `default` (`~/.aws`), que se configuran con ella.
- Detalles internos decididos (dentro de DEC aprobadas):
  - Amplify v6 envía por defecto el *access token*, que no trae `custom:customerId`. La app sobrescribe `Authorization` con el *ID token* mediante `headers` de la configuración de la librería (verificado en el fuente de `@aws-amplify/api-graphql`: las cabeceras de la configuración se aplican después de las de auth). Humo y aceptación también usan el ID token.
  - La Lambda exige `custom:customerId` y el grupo en todas las operaciones, también en `listProducts`, para que el esqueleto ejercite DEC-004 de punta a punta.
  - El cliente Cognito tiene habilitado `USER_PASSWORD_AUTH` además de SRP, para que humo y aceptación inicien sesión desde Node.
  - `overrides.react = 19.3.0` en la raíz para evitar React duplicado por hoisting (lo detectó expo-doctor).
  - La config de aceptación es `vitest.acceptance.config.ts` en la raíz, para no tocar `tests/acceptance/` fuera de T-03.
  - No se aprobó el postinstall de esbuild (npm `allowScripts`): el binario funciona sin él.
- Desvío registrado: DEC-002 menciona tipos GraphQL generados desde el contrato. Con un solo campo, en T-01 se escribieron a mano en `backend/src/domain/catalog.ts` y `app/src/lib/api.ts`. Hay que agregar codegen cuando crezca el contrato (T-04/T-05).
- Spike Amplify + Expo Go: sin resolver (requiere teléfono). `@aws-amplify/react-native` incluye código nativo (`AmplifyRTNCore`), así que es probable que Expo Go no sirva y haga falta un development build (`npx expo run:android|ios`). Confirmar en el teléfono.
- Bloqueos nuevos: ninguno de spec. Falta entorno: AWS CLI y credenciales (responsable: usuario).
- Próxima acción autorizada: (1) el usuario instala AWS CLI y configura el perfil `default` (`aws configure`, región `us-east-1`); (2) `npm run bootstrap:dev` (una sola vez) → `npm run deploy:dev` → `npm run smoke`, y anotar la latencia que imprime el humo (criterio: primera < 3 s, siguientes < 1 s); (3) `npm run app` + login de almacen1 desde el teléfono (spike Expo Go / dev build), registrado aquí; (4) con evidencia completa, revisión independiente de T-01. Mientras tanto, T-02 puede avanzar (no requiere AWS).

## 2026-10-17 18:50 · Claude (claude-opus-5-5)
- Hecho: T-02 (commit 35d7c69). `scripts/check-spec.mjs` (`npm run check:spec`) valida TASKS.json (JSON, ids, estados, referencias a REQ/DEC/T existentes), `done` con `evidence.command/result/commit`, `blocked` con `blocked_by` referenciado (reqs/decisions/depends_on o Q- de SPEC.md), lista cerrada de archivos en `spec/` y, en cada commit del historial, trailers `Task:`/`Req:` válidos y que solo tareas `"kind": "spec"` toquen `tests/acceptance/`. Hook `.githooks/commit-msg` (activado por `npm ci` vía `prepare`) aplica lo mismo al mensaje y al diff preparado.
- Detalle interno: T-03 lleva ahora `"kind": "spec"` en TASKS.json (no cambia alcance: ya era "tarea de spec"). AGENTS.md menciona el campo y el hook.
- Hallazgo: en los commits existentes `Task:`/`Req:` no son trailers git reales (Co-Authored-By va en otro párrafo); el validador los busca por línea, así que no hace falta reescribir historia.
- Verificado y cómo: `npm run lint` ok; `npm run typecheck` ok; `npm test` 37/37 (23 de check-spec con fixtures negativos en repos git temporales); `npm run check:spec` ok; commit sin trailers en el repo real → rechazado por el hook (exit 1).
- En curso / roto: T-01 sigue `in_progress` (despliegue pendiente: AWS CLI/credenciales). T-02 `verified_auto`.
- Bloqueos nuevos: ninguno.
- Próxima acción autorizada: (1) revisión independiente de T-02 con contexto limpio (diff 35d7c69; sin REQ/DEC citadas); (2) retomar T-01 cuando el usuario tenga AWS CLI + perfil `default` (pasos en la entrada de 18:55); T-03 sigue esperando a T-01.

## 2026-10-17 19:15 · Claude (claude-fable-5-1 → claude-opus-5-5)
- Hecho: T-08 Orquestador nocturno (commit 3ca661f), creada a pedido del usuario como `"kind": "tooling"` sin REQ de producto. `scripts/night-loop.sh` + `scripts/lib/night-tasks.mjs`: elige la primera `ready` con dependencias cerradas, lanza `claude -p` con permisos acotados (sin push, deploy, AWS, red), exige árbol limpio + sin estados reservados + `check:spec`, lanza revisor con contexto limpio (`codex exec` read-only o `claude -p` solo lectura) con el prompt de sdd.md §7.5 sobre diff + REQ/DEC, y registra el veredicto en TASKS.json y aquí. Para ante blocked, 2 fallos, 2 h o 3 tareas. `check-spec` admite `Req: N/A` solo en tareas tooling. AGENTS.md documenta el comando.
- Aprobación del usuario: **José Pedro Lübbert**, 2026-10-17 — aprueba el commit de T-08 y los supuestos: dependencias cerradas = `done`/`accepted`/`delivered`; una tarea que queda `done` también pasa por el revisor.
- Verificado y cómo: `npm run lint` ok; `npm run typecheck` ok; `npm test` 63/63 (ciclo completo con dobles de claude/codex en git temporal); `npm run check:spec` ok; `scripts/night-loop.sh --dry-run` en el repo real → sin tareas elegibles, nada escrito.
- En curso / roto: T-08 `verified_auto`. T-01 sigue `in_progress` (despliegue pendiente). Mientras T-01 no cierre, el orquestador no tiene tareas que tomar.
- Bloqueos nuevos: ninguno.
- Próxima acción autorizada: (1) revisión independiente de T-02 y T-08 con contexto limpio; (2) retomar T-01 cuando el usuario tenga AWS CLI + perfil `default`.

## 2026-10-17 19:40 · Claude (claude-fable-5-1 → claude-opus-5-5)
- Hecho: registro de la revisión independiente y la aceptación de T-02 y T-08 (solo spec/TASKS.json y esta bitácora; sin código).
- Revisión independiente (Codex GPT-6.1 Sol, contexto limpio), según lo transcrito por el usuario:
  - T-02: **approved**. 25/25 pruebas, check:spec ok, sin cambios fuera de alcance ni violaciones de DEC.
  - T-08: **approved**. 24/24 pruebas. Salvedad no bloqueante: `--dry-run` crea `.night-loop/.gitignore` y `.night-loop/lock` (ignorados por git). Atendida: el `verify` de T-08 ahora dice "sin modificar archivos versionados".
  - Veredictos guardados en `review` de cada tarea (reviewer: codex gpt-6.1-sol) → `reviewed`.
- Aceptación: **José Pedro Lübbert**, 2026-10-17 — acepta T-02 y T-08 → `accepted` (campo `acceptance` en TASKS.json).
- Verificado y cómo: `npm run check:spec` → ok.
- En curso / roto: T-01 sigue `in_progress` (despliegue pendiente: AWS CLI + perfil `default`).
- Bloqueos nuevos: ninguno.
- Próxima acción autorizada: retomar T-01 cuando el usuario tenga AWS CLI + perfil `default` (pasos en la entrada de 18:55). T-03..T-07 siguen esperando a T-01, así que el orquestador nocturno no tiene tareas elegibles.

## 2026-10-17 20:15 · Claude (claude-opus-5-5)
- Hecho: despliegue de T-01 en dev. Cuenta [REDACTED_AWS_ACCOUNT_MAIN] (usuario IAM `[REDACTED_IAM_USER]`), perfil `default`, `us-east-1` (R-04). `npm run bootstrap:dev` (CDKToolkit creado) → `npm run deploy:dev` (pila `PedidosB2B-dev` creada, `.env.dev` escrito, seed: Yerba 1 kg, Arroz 1 kg; almacen1/almacen2) → `npm run smoke`.
- Verificado y cómo: `npm ci` ok; `npm run lint` ok; `npm run typecheck` ok; `npm run smoke` 2/2 (almacen1 → listProducts con los 2 productos; sin token → Unauthorized). Latencia listProducts: primera 603 ms (< 3 s), siguiente 564 ms (< 1 s) → criterio cumplido. `.env.dev` ignorado por git (`.gitignore:2`).
- En curso / roto: **`npm test` 60/63**. Fallan 3 casos de `scripts/test/night-tasks.test.ts` (check-authority "detecta estados reservados…", set-review "approved sobre verified_auto…" y "rejected conserva…"). Causa: copian `spec/` real y dan por hecho que T-02 está `verified_auto`; desde 300e0a9 está `accepted`. No es una regresión del código de T-01 ni de T-08: es la fixture la que depende del estado vivo. Arreglo propuesto: fijar `T-02.status = 'verified_auto'` dentro de esos casos (un `editTasks` al inicio). El clasificador de permisos de la sesión bloqueó la edición de la prueba, así que queda pendiente de que el usuario lo autorice.
- T-01 sigue `in_progress`: falta el login manual desde el teléfono (spike Expo Go / dev build).
- Bloqueos nuevos: ninguno de spec.
- Próxima acción autorizada: (1) el usuario autoriza o aplica el arreglo de la fixture de night-tasks.test.ts (Task: T-08, Req: N/A) → `npm test` 63/63; (2) `npm run app` + login de almacen1 desde el teléfono (Expo Go; si falla por `AmplifyRTNCore`, development build con `npx expo run:android|ios`), registrado aquí; (3) con eso, evidencia de T-01 en TASKS.json → `verified_auto` y revisión independiente con contexto limpio.

## 2026-10-17 20:50 · Claude (claude-opus-5-5)
- Hecho: alineado del proyecto con el Expo Go de la Play Store (T-01). Síntoma en el teléfono Android: "Project is incompatible with this version of Expo Go". Diagnóstico: el proyecto estaba en SDK 58 (`latest` en npm) y `npx expo install --fix` no cambiaba nada (dependencias ya alineadas con 58). Metro servía `sdkVersion 58.0.0`, pero el Expo Go de la tienda soporta SDK 57 (confirmado por el usuario). Arreglo: `expo ~57.0.30` + `npx expo install --fix` (React 19.2.3, RN 0.86.3, expo-router 57, etc.), `override` de `react` en la raíz → 19.2.3, `@types/react ~19.2.4`, `package-lock.json` regenerado (fuera de Expo/RN solo cambian `open` y `whatwg-url-minimum`, transitivas de Expo). Registrado como DEC-008 (`proposed`).
- Verificado y cómo: `npm ci` ok; `npm run lint` ok; `npm run typecheck` ok; `npm run check:spec` ok; `npx expo-doctor` 21/21; `npx expo install --check` al día; `npx expo export --platform android` ok; manifiesto de Metro → `sdkVersion 57.0.0`; Expo Go 57.0.9 (APK oficial) en emulador Android 35 → la app abre en "Iniciar sesión", con "SDK version: 57.0.0" y sin errores en logcat.
- En curso / roto: `npm test` 60/63, las mismas 3 fallas de `night-tasks.test.ts` de la entrada de 20:15 (fixture que depende del estado vivo de T-02), sin relación con este cambio. No probado: el teléfono físico ni el login (sigue siendo el spike de T-01).
- Nota: `react-native-worklets@0.13.0` (transitiva de expo-router, la app no la usa) queda fuera del rango del peer opcional de `expo-modules-core@57`. expo-doctor no lo marca.
- Bloqueos nuevos: ninguno.
- Próxima acción autorizada: (1) el usuario escanea el QR de `npm run app` con el Expo Go de la Play Store y hace login con almacen1 (spike de T-01), registrado aquí; (2) el usuario aprueba o rechaza DEC-008; (3) arreglo de la fixture de night-tasks.test.ts (pendiente de autorización, entrada de 20:15); (4) evidencia de T-01 → `verified_auto` y revisión independiente.

## 2026-10-17 21:20 · Claude (claude-opus-5-5)
- Hecho: login de la app con `USER_PASSWORD_AUTH` en vez de SRP (T-01, spike Amplify + Expo Go). Síntoma en Expo Go: "An unknown error has occurred" al iniciar sesión, sin más detalle en Metro. Causa probable (indicada por el usuario, sin confirmar todavía): SRP necesita el módulo nativo `AmplifyRTNCore`, que Expo Go no trae. `app/src/app/index.tsx`: `signIn(..., options: { authFlowType: 'USER_PASSWORD_AUTH' })`. El cliente Cognito ya tenía `userPassword: true` (`infra/lib/pedidos-stack.ts:35`), así que no hace falta redesplegar (solo se actualizó el comentario). Si vuelve a fallar, la pantalla muestra `name: message`, el `underlyingError` y la `recoverySuggestion` de Amplify.
- Decisión (usuario, José Pedro Lübbert, 2026-10-17): usar `USER_PASSWORD_AUTH` en la app para seguir con Expo Go en vez de pasar a development build. Contraseña sobre TLS hacia Cognito en vez de SRP; aceptable para la demo. DEC-004 menciona "(SRP)" en la descripción de la alternativa, pero su decisión es sobre la identidad (`custom:customerId`) y no cambia. Ver SPEC.md §spike: el resultado se anota aquí, no es DEC nueva.
- Verificado y cómo: `npm run lint` ok; `npm run typecheck` ok; `npm run check:spec` ok. No probado: login real en el teléfono.
- En curso / roto: `npm test` sigue con las 3 fallas de fixture de `night-tasks.test.ts` (entrada de 20:15), sin relación con este cambio.
- Bloqueos nuevos: ninguno.
- Próxima acción autorizada: (1) el usuario recarga la app en Expo Go y hace login con almacen1; si falla, transcribe el error que ahora se ve en pantalla; si funciona, se registra aquí como cierre del spike; (2) el usuario aprueba o rechaza DEC-008; (3) arreglo de la fixture de night-tasks.test.ts (pendiente de autorización); (4) evidencia de T-01 → `verified_auto` y revisión independiente.

## 2026-10-17 21:40 · Claude (claude-opus-5-5)
- Hecho: (1) cierre del spike de T-01: el usuario confirma login de almacen1 en el teléfono con el Expo Go 57 de la Play Store (`USER_PASSWORD_AUTH`, f9124a3); la app muestra Yerba y Arroz. (2) Evidencia de T-01 en TASKS.json → `verified_auto`. (3) DEC-008 → `accepted`, aprobada por José Pedro Lübbert (2026-10-17). (4) Arreglo de las 3 pruebas de `scripts/test/night-tasks.test.ts` (09f1db2, Task: T-08, Req: N/A, autorizado por el usuario): ya no copian `spec/` del repo sino una spec fija en `scripts/test/fixtures/night-spec/` (SPEC, DECISIONS, TASKS y LOG mínimos; T-02 `verified_auto`, T-01 `in_progress`), así el estado vivo del proyecto no las rompe.
- Verificado y cómo: `npm run lint` ok; `npm run typecheck` ok; `npm test` 63/63; `npm run check:spec` ok.
- En curso / roto: nada roto. T-01 `verified_auto`, pendiente de revisión independiente.
- Bloqueos nuevos: ninguno.
- Próxima acción autorizada: (1) revisión independiente de T-01 con contexto limpio (diff dec433c..f9124a3, REQ-001, REQ-002, DEC-001..008) → `reviewed`; (2) aceptación del usuario; con T-01 cerrada, T-03 (tarea de spec) queda elegible.

## 2026-10-17 22:10 · Claude (claude-opus-5-5)
- Revisión independiente de T-01 (Codex), según lo transcrito por el usuario: **rejected**. Hallazgo: incumple DEC-002, los tipos GraphQL se escribieron a mano en vez de generarse desde `spec/contracts/schema.graphql`. Registrado en `review` de T-01.
- Hecho (corrección, 8a6dbc7): `npm run codegen` (GraphQL Code Generator, `codegen.ts`) genera `backend/src/generated/graphql.ts` (plugin `typescript`) y `app/src/lib/generated/graphql.ts` (`typescript` + `typescript-operations` sobre las consultas `/* GraphQL */` de `app/src`). Reemplazados los tipos manuales: en el backend, el `Product` del dominio = `Product` del contrato + `active`, y los resolvers de Query se tipan con `Query[campo]`; en la app, `api.ts` usa `Product` y `ListProductsQuery` generados. `scripts/codegen/appsync.graphql` declara directivas y escalares de AppSync solo para la generación. Salida versionada; `scripts/test/codegen.test.ts` corre `graphql-codegen --check` y falla si quedó desactualizada. Dependencias de desarrollo nuevas en la raíz: `@graphql-codegen/cli` 7.4.6, `@graphql-codegen/typescript` 6.1.2, `@graphql-codegen/typescript-operations` 6.1.10, `graphql` 16.14.2 (ya estaba como transitiva).
- Verificado y cómo: `npm run lint` ok; `npm run typecheck` ok; `npm test` 64/64; `graphql-codegen --check` → exit 1 con un archivo generado alterado y exit 0 tras regenerar; `npx expo export --platform android` ok; `npm run check:spec` ok. No redesplegué ni repetí el smoke: el cambio es solo de tipos, sin cambio de comportamiento.
- En curso / roto: T-01 `verified_auto` (evidencia actualizada, commit 8a6dbc7), pendiente de nueva revisión.
- Bloqueos nuevos: ninguno.
- Próxima acción autorizada: (1) nueva revisión independiente de T-01 con contexto limpio (diff dec433c..8a6dbc7, REQ-001, REQ-002, DEC-001..008) → `reviewed`; (2) aceptación del usuario.

## 2026-10-17 22:30 · Claude (claude-opus-5-5)
- Hecho: registro de la segunda revisión independiente y la aceptación de T-01 (solo spec/TASKS.json y esta bitácora; sin código).
- Revisión independiente (Codex, sesión nueva, contexto limpio), según lo transcrito por el usuario: **approved**. 64/64 pruebas, sin cambios fuera de alcance, DEC-002 cumplida. Guardado en `review` de T-01 (el rechazo anterior queda anotado en `review.notes`) → `reviewed`.
- Aceptación: **José Pedro Lübbert**, 2026-10-17 — acepta T-01 → `accepted` (campo `acceptance` en TASKS.json).
- Verificado y cómo: `npm run check:spec` → ok.
- En curso / roto: nada. T-01, T-02 y T-08 `accepted`.
- Bloqueos nuevos: ninguno.
- Próxima acción autorizada: T-03 (tarea `"kind": "spec"`, `approved_for_impl`) queda elegible ahora que su dependencia T-01 está cerrada; puede tomarla una sesión interactiva o el orquestador nocturno (`scripts/night-loop.sh`).

## 2026-10-17 21:33 · night-loop (scripts/night-loop.sh)
- Hecho: nada. Corrida 2026-10-17_213347 (0 min, 0 tarea(s) completada(s), 0 fallo(s)); registros en .night-loop/2026-10-17_213347/.
- Verificado y cómo: sin comandos ejecutados.
- En curso / roto: árbol limpio en 3d61197.
- Bloqueos nuevos: ninguno.
- Motivo de parada: no hay tareas ready con dependencias cerradas.
- Próxima acción autorizada: el usuario revisa este resumen, los veredictos registrados en TASKS.json y los registros de la corrida; decide accepted o devuelve la tarea. El orquestador no marca accepted ni hace push.

## 2026-10-17 22:45 · Claude (claude-opus-5-5)
- Hecho: el orquestador nocturno no tomaba T-03 porque `pick` solo elegía tareas `ready`, y T-03 está `approved_for_impl`. Pedido del usuario como cambio de T-08 (Task: T-08, Req: N/A): `pick` (`scripts/lib/night-tasks.mjs`) ahora elige la primera tarea en `ELIGIBLE_STATES = ['ready', 'approved_for_impl']` cuyas dependencias estén cerradas. Se actualizaron la cabecera y el motivo de parada de `scripts/night-loop.sh`. `check-authority` no cambia: el ejecutor sigue sin poder *otorgar* `approved_for_impl`, solo partir de ese estado.
- Pruebas (`scripts/test/night-tasks.test.ts`): caso nuevo "elige una approved_for_impl cuyas dependencias están cerradas, igual que una ready" (falla con el `pick` anterior y pasa con el nuevo); caso nuevo "no elige tareas en otros estados aunque sus dependencias estén cerradas"; el caso "no elige nada…" ya no convierte `ready` en `approved_for_impl` (eso ahora sería elegible) y usa la fixture tal cual.
- Ningún estado de tarea cambió (spec/TASKS.json intacto).
- Verificado y cómo: `npm run lint` ok; `npm run typecheck` ok; `npm test` 66/66; `npm run check:spec` ok; `scripts/night-loop.sh --dry-run` en el repo real → "Tarea elegida: T-03 (estado approved_for_impl, kind spec)", sin cambios en el árbol.
- En curso / roto: nada.
- Bloqueos nuevos: ninguno.
- Próxima acción autorizada: correr `scripts/night-loop.sh` (o una sesión interactiva) para T-03; revisión independiente de este cambio de T-08 si el usuario la quiere antes.

## 2026-10-17 22:55 · Claude (claude-opus-5-5)
- Hecho: T-03 (tarea de spec) → `in_progress`. Pruebas de aceptación en `tests/acceptance/`: `req_001_login` (E4 sin token y con token inválido), `req_002_catalogo` (E1 orden y campos, orden de toda la lista, E2 inactivo, E3 catálogo vacío desactivando todo y restaurando), `req_003_pedido` (E1–E7 más bordes: 1 y 999 se aceptan, una línea mala anula todo el pedido, fusión 500+500 → `INVALID_QUANTITY`, 50 líneas se aceptan), `req_004_mis_pedidos` (E1–E5 más estado fuera de S-04 en el script); 25 casos. `support/fixtures.ts` siembra productos `acept-*` directo en la tabla (claves de DEC-006) y crea clientes desechables en Cognito; todo se borra al terminar y se barre al empezar.
- Decisión registrada (R-03): DEC-009 `proposed`, forma de la API de pedidos (`createOrder`, `myOrders`, `order(id)`, `OrderLine.subtotal`, `productId` en el `message` de `PRODUCT_UNAVAILABLE`, `npm run order:set-status -- <id> <estado>`). El contrato no se tocó: lo extienden T-04..T-06. DEC-009 citada también en T-05 y T-06.
- Supuestos nuevos en SPEC.md: S-12 (REQ-003 E2: la entrada no tiene campo de precio; si se manda, AppSync rechaza sin crear pedido), S-13 (REQ-004 E1: orden por momento de confirmación, sin fechas pasadas), S-14 (clientes desechables en vez de almacen1 para no ensuciar la demo).
- Verificado y cómo: `npm run lint` ok; `npm run typecheck` ok; `npm test` 66/66; `npm run check:spec` ok. `npm run test:acceptance`: req_001 2/2 pasa; req_002..004 no llegaron a correr: la sesión del agente no tiene credenciales AWS (`CredentialsProviderError` en el `beforeAll`).
- Fallas esperadas cuando corra con credenciales: req_001 y req_002 deberían pasar (T-01 ya filtra y ordena); req_003 y req_004 deben fallar con `ValidationError` de AppSync (`createOrder`/`myOrders`/`order` no están en el contrato) y REQ-004 E2 además por `Missing script: "order:set-status"`.
- Riesgo: REQ-002 E3 desactiva todo el catálogo de `dev` unos segundos; si la corrida se corta justo ahí, `npm run seed` lo restaura.
- Bloqueos nuevos: ninguno de spec. Falta acceso AWS en la sesión del agente.
- Próxima acción autorizada: (1) el usuario corre `npm run test:acceptance` con el perfil `default` y confirma que fallan por la razón esperada (arriba); con eso, evidencia de T-03 → `verified_auto`; (2) el usuario revisa y aprueba el diff de `tests/acceptance/` (lo exige T-03), DEC-009 y S-12..S-14; (3) revisión independiente de T-03; luego T-04.

## 2026-10-17 21:53 · night-loop (scripts/night-loop.sh)
- Hecho: T-03: el implementador terminó en in_progress (código 0); T-03: el implementador terminó en in_progress (código 0). Corrida 2026-10-17_214535 (7 min, 0 tarea(s) completada(s), 2 fallo(s)); registros en .night-loop/2026-10-17_214535/.
- Verificado y cómo: sin comandos ejecutados.
- En curso / roto: árbol limpio en b3864e7.
- Bloqueos nuevos: ninguno.
- Motivo de parada: 2 fallos (tope 2).
- Próxima acción autorizada: el usuario revisa este resumen, los veredictos registrados en TASKS.json y los registros de la corrida; decide accepted o devuelve la tarea. El orquestador no marca accepted ni hace push.
