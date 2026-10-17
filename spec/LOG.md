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
