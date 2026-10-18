# Instrucciones para agentes

Proyecto: demo de pedidos B2B (almacenero → catálogo → pedido → estado).
Stack fijo (R-01): AWS Cognito, AppSync, Lambda, DynamoDB · app React Native (Expo).
Protocolo: Cierre por Riesgo (PCR), variante "desarrollador único": `PLAN` vive como sección de `spec/SPEC.md`.

## Lectura obligatoria al iniciar (en este orden)
1. spec/LOG.md — última entrada: "Próxima acción autorizada"
2. spec/TASKS.json — tareas `in_progress`, `blocked` y la primera `ready`
3. spec/SPEC.md — Objetivo, Alcance, Plan y requisitos citados por la tarea
4. spec/DECISIONS.md — solo decisiones citadas por la tarea o `accepted` globales
5. git log -n 20

No cargues la spec completa si la tarea no la cita. Nunca reconstruyas estado desde el chat.

## Estructura (se crea en T-01)
- `app/` — React Native + Expo (TypeScript)
- `backend/` — Lambdas y dominio (TypeScript)
- `infra/` — AWS CDK v2 (TypeScript), una pila `PedidosB2B-<stage>`
- `spec/contracts/schema.graphql` — contrato de la API (fuente única; la infra lo lee de ahí)
- `scripts/` — seed de catálogo/usuarios, cambio de estado de pedido
- `tests/smoke/` — prueba de humo · `tests/acceptance/` — **protegida**

## Comandos (existen a partir de T-01; T-02 añade `check:spec`)
- Preparar entorno: `npm ci` · una vez por cuenta: `npm run bootstrap:dev` · desplegar dev: `npm run deploy:dev` (escribe `.env.dev` y siembra)
- Prueba de humo: `npm run smoke`
- Pruebas: `npm test` | Aceptación: `npm run test:acceptance` | Lint/tipos: `npm run lint && npm run typecheck`
- Validar protocolo: `npm run check:spec` (hook `commit-msg` en `.githooks/`, lo activa `npm ci` vía `prepare`)
- Orquestador nocturno (T-08): `scripts/night-loop.sh [--dry-run]` (nunca push, despliegue ni `accepted`; AWS solo con el perfil `night-loop` para `test:acceptance`/`smoke`, DEC-010; progreso en `.night-loop/<corrida>/live.log`; tareas `"kind": "tooling"` usan `Req: N/A`)
  En el loop la tarea que necesita desplegar queda `in_progress` con una línea `- Pendiente deploy:` en LOG.md (qué desplegar y qué correr después); el loop sigue con la siguiente.
- App: `npm run app` (Expo)

## Autoridad
- PUEDES decidir: detalles internos dentro del diseño aprobado (anótalos en el commit).
- PUEDES decidir y registrar sin preguntar: decisiones técnicas dentro del stack R-01
  (delegación del usuario, R-03). Las globales van como DEC en spec/DECISIONS.md.
- PUEDES pasar a `verified_auto` una tarea cuyo único pendiente es una verificación manual en el teléfono:
  evidencia automática + `evidence.manual_pending` (qué y cómo) y línea `- Pendiente manual:` en LOG.md;
  la hace el usuario al aceptar en lote (DEC-011).
- DEBES registrar: toda interpretación de un requisito ambiguo (supuesto en SPEC.md).
- DEBES DETENERTE Y ESCALAR: cambio de requisito, alcance o regla de negocio;
  edición de tests/acceptance/ fuera de su tarea de spec; servicio o proveedor fuera de R-01;
  desplegar fuera de perfil `default` / `us-east-1` (R-04); decisión global no registrada;
  dos intentos fallidos sobre la misma falla.

## Reglas duras (verificadas por `npm run check:spec` y hook de commit, T-02)
- No edites tests/acceptance/ en un cambio de implementación (solo tareas con `"kind": "spec"` en TASKS.json).
- Una tarea pasa a `done` solo con evidencia (comando + resultado + commit) en TASKS.json.
- Cada commit lleva trailers `Task:` y `Req:` (`Req: none` si no aplica).
- No reabras una decisión `accepted` sin evidencia nueva registrada; se supersede, no se edita.
- No marques `reviewed`, `accepted` ni `approved_for_impl`: solo revisor / usuario.
- No subas secretos: `.env*` y salidas de CDK fuera de git.

## Revisión independiente
Antes de `reviewed`, un revisor con contexto limpio recibe solo: diff, REQ de la tarea y DEC citadas.
Responde: ¿cada REQ implementado y probado (incluidos bordes)? ¿cambió algo fuera de alcance?
¿se violó una DEC aceptada? Sin cita a REQ/DEC, un hallazgo no bloquea. Estilo no bloquea.

## Al terminar la sesión
Commit limpio + entrada en spec/LOG.md con "Próxima acción autorizada".
