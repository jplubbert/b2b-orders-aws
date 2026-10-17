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
