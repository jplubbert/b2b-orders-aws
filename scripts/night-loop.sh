#!/usr/bin/env bash
# Orquestador nocturno (T-08). Ejecuta tareas del protocolo PCR sin supervisión, dentro de un presupuesto.
#
#   scripts/night-loop.sh [--dry-run] [--task T-NN] [--max-tasks N] [--budget-seconds N] [--max-failures N]
#
# Ciclo:
#   0. Antes de elegir tarea nueva, revisa cada tarea en verified_auto (p. ej. implementada en una sesión interactiva)
#      con el mismo revisor y mecanismo del paso 3; cada una se revisa una sola vez por corrida (un rechazo la deja
#      en verified_auto y no se repite hasta la próxima corrida).
#   1. Elige la primera tarea "ready" o "approved_for_impl" de spec/TASKS.json con todas sus dependencias cerradas
#      (done/accepted/delivered, o reviewed: así encadena tareas sin esperar la aceptación del usuario).
#      Si no hay, anota en spec/LOG.md y termina.
#   2. Lanza el implementador: `claude -p "Lee AGENTS.md y ejecuta <ID>. Detente según las reglas de autoridad."`
#      con permisos acotados al repositorio (sin red, sin push, sin instalar nada fuera de npm; AWS solo con el perfil
#      `night-loop` para `npm run test:acceptance` y `npm run smoke`). Progreso en vivo (stream-json → líneas legibles)
#      en la terminal y en .night-loop/<corrida>/live.log (`tail -f` desde otra terminal). Tokens de cada invocación
#      (entrada, salida, caché leída y escrita, del campo `usage` del evento `result`) por tarea y total de la corrida
#      en la terminal, live.log y el resumen de LOG.md; el revisor no se cuenta (codex/claude en texto no los informan).
#   3. Si la tarea queda verified_auto (o done), lanza un revisor con contexto limpio (`codex exec`, o `claude -p`
#      si no hay codex) con el prompt de sdd.md §7.5, solo sobre el diff de la tarea y sus REQ/DEC. El veredicto va a
#      TASKS.json (`review`; approved → reviewed) y a LOG.md.
#   4. Se detiene si la tarea queda blocked, si hay dos fallos, si vence el presupuesto (2 h) o si completa 3 tareas.
#      Siempre deja un resumen en LOG.md (y lo confirma con Task: T-08 / Req: N/A, salvo que el árbol quede sucio).
#      Código de salida 1 si la parada requiere intervención (blocked, fallos, violación de autoridad, sin veredicto).
#   5. Nunca hace push, nunca despliega a AWS ni marca accepted/reviewed por su cuenta (reviewed solo con veredicto).
#
# Guardas mecánicas sobre los procesos hijos: solo el perfil AWS `night-loop` (usuario IAM night-loop-tests, DEC-010:
# datos de la tabla y admin del user pool de PedidosB2B-dev) copiado a un AWS_CONFIG_FILE/AWS_SHARED_CREDENTIALS_FILE
# temporales, así que `default` no existe para ellos (deploy/bootstrap/cdk fallan además por permisos); pushurl de
# todos los remotos apuntado a una ruta inexistente, herramientas de red y despliegue denegadas al implementador,
# y comprobación tras cada tarea de que el ejecutor no otorgó estados reservados (reviewed/accepted/…).
#
# Variables: NIGHT_MAX_TASKS (3), NIGHT_BUDGET_SECONDS (7200), NIGHT_MAX_FAILURES (2), NIGHT_REVIEWER (auto|codex|claude),
#            NIGHT_IMPL_MODEL, NIGHT_REVIEW_MODEL, NIGHT_MAX_USD (tope por invocación de claude, opcional),
#            NIGHT_AWS_PROFILE (night-loop), NIGHT_AWS_CREDENTIALS (origen de las llaves; ~/.aws/credentials).
# Registros de cada corrida: .night-loop/<fecha>/ (fuera de git).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

MAX_TASKS=${NIGHT_MAX_TASKS:-3}
BUDGET=${NIGHT_BUDGET_SECONDS:-7200}
MAX_FAILURES=${NIGHT_MAX_FAILURES:-2}
REVIEWER=${NIGHT_REVIEWER:-auto}
DRY_RUN=0
FORCED_TASK=""

usage() { sed -n '2,/^set -euo/{/^set -euo/!p}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --task) FORCED_TASK=$2; shift ;;
    --max-tasks) MAX_TASKS=$2; shift ;;
    --budget-seconds) BUDGET=$2; shift ;;
    --max-failures) MAX_FAILURES=$2; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "night-loop: argumento desconocido: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

tasks() { node "$ROOT/scripts/lib/night-tasks.mjs" --root "$ROOT" "$@"; }
RUN_ID=$(date '+%Y-%m-%d_%H%M%S')
RUN_DIR="$ROOT/.night-loop/$RUN_ID"
LIVE="$RUN_DIR/live.log"
TOKENS="$RUN_DIR/tokens.jsonl"   # una línea por invocación del implementador (night-stream.mjs --tokens)
START=$(date +%s)
DEADLINE=$((START + BUDGET))
SUMMARY=()        # líneas "Hecho" del resumen
VERIFIED=()       # líneas "Verificado y cómo"
STOP_REASON=""
ABNORMAL=0       # 1 = parada que requiere intervención (blocked, fallos, violación, árbol sucio, sin veredicto)
TASKS_DONE=0
FAILURES=0
REVIEWED_IDS=" "  # tareas ya revisadas en esta corrida (no se revisan dos veces)

log() { # a la terminal y, en una corrida real, a live.log
  local line; line=$(printf '%s night-loop: %s' "$(date '+%H:%M:%S')" "$*")
  printf '%s\n' "$line"
  if [ "$DRY_RUN" = 0 ] && [ -d "$RUN_DIR" ]; then printf '%s\n' "$line" >>"$LIVE"; fi
  return 0
}
die() { echo "night-loop: $*" >&2; exit 1; }
tokens_summary() { node "$ROOT/scripts/lib/night-stream.mjs" tokens-summary "$TOKENS"; }
remaining() { echo $((DEADLINE - $(date +%s))); }
now_stamp() { date '+%Y-%m-%d %H:%M'; }
git_head() { git rev-parse --short HEAD; }

# ---------- Guardas de entorno (heredadas por claude/codex y todo lo que lancen) ----------
export NIGHT_LOOP=1
export CI=1
# AWS: solo el perfil night-loop (DEC-010), copiado a archivos temporales; default y el resto no existen para los hijos.
NIGHT_AWS_PROFILE=${NIGHT_AWS_PROFILE:-night-loop}
AWS_SOURCE=${NIGHT_AWS_CREDENTIALS:-${AWS_SHARED_CREDENTIALS_FILE:-$HOME/.aws/credentials}}
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE AWS_DEFAULT_REGION
AWS_SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/night-loop-aws.XXXXXX")
trap 'rm -rf "$AWS_SANDBOX"' EXIT
aws_profile_key() { # $1 = clave; lee la sección [$NIGHT_AWS_PROFILE] del archivo de credenciales de origen
  [ -r "$AWS_SOURCE" ] || return 0
  awk -v sec="[$NIGHT_AWS_PROFILE]" -v key="$1" '
    /^[[:space:]]*\[/ { gsub(/[[:space:]]/, ""); inside = ($0 == sec); next }
    inside { split($0, kv, "="); k = kv[1]; gsub(/[[:space:]]/, "", k)
             if (k == key) { v = substr($0, index($0, "=") + 1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", v); print v; exit } }' "$AWS_SOURCE"
}
AWS_KEY_ID=$(aws_profile_key aws_access_key_id)
( umask 077
  printf '[profile %s]\nregion = us-east-1\n' "$NIGHT_AWS_PROFILE" >"$AWS_SANDBOX/config"
  if [ -n "$AWS_KEY_ID" ]; then
    printf '[%s]\naws_access_key_id = %s\naws_secret_access_key = %s\n' \
      "$NIGHT_AWS_PROFILE" "$AWS_KEY_ID" "$(aws_profile_key aws_secret_access_key)" >"$AWS_SANDBOX/credentials"
  else
    : >"$AWS_SANDBOX/credentials"
  fi )
export AWS_CONFIG_FILE=$AWS_SANDBOX/config AWS_SHARED_CREDENTIALS_FILE=$AWS_SANDBOX/credentials
export AWS_PROFILE=$NIGHT_AWS_PROFILE AWS_REGION=us-east-1 AWS_EC2_METADATA_DISABLED=true
n=0
for remote in $(git remote); do
  export "GIT_CONFIG_KEY_${n}=remote.${remote}.pushurl" "GIT_CONFIG_VALUE_${n}=/nonexistent/night-loop-sin-push"
  n=$((n + 1))
done
[ "$n" -gt 0 ] && export GIT_CONFIG_COUNT=$n
unset n remote

# ---------- Permisos del implementador (claude -p) ----------
IMPL_ALLOWED=(
  Read Edit Write MultiEdit Glob Grep TodoWrite
  "Bash(npm *)" "Bash(npx *)" "Bash(node *)" "Bash(tsx *)" "Bash(git *)"
  "Bash(ls *)" "Bash(ls)" "Bash(cat *)" "Bash(head *)" "Bash(tail *)" "Bash(sed *)" "Bash(grep *)" "Bash(find *)"
  "Bash(wc *)" "Bash(diff *)" "Bash(sort *)" "Bash(mkdir *)" "Bash(cp *)" "Bash(mv *)" "Bash(chmod *)"
  "Bash(echo *)" "Bash(printf *)" "Bash(test *)" "Bash(which *)" "Bash(pwd)" "Bash(date *)" "Bash(date)"
  "Bash(jq *)" "Bash(tee *)" "Bash(xargs *)" "Bash(env)" "Bash(true)"
)
IMPL_DENIED=(
  WebFetch WebSearch Agent
  "Bash(git push*)" "Bash(git remote*)" "Bash(git config*)" "Bash(gh *)"
  "Bash(npm run deploy*)" "Bash(npm run bootstrap*)" "Bash(npm run seed*)" "Bash(npm publish*)"
  "Bash(npx cdk*)" "Bash(cdk *)" "Bash(npx eas*)" "Bash(eas *)" "Bash(npx expo publish*)" "Bash(npx expo run*)"
  "Bash(aws *)" "Bash(curl *)" "Bash(wget *)" "Bash(ssh *)" "Bash(scp *)" "Bash(sudo *)" "Bash(rm *)"
)
REVIEW_ALLOWED=(
  Read Glob Grep
  "Bash(npm test*)" "Bash(npm run lint*)" "Bash(npm run typecheck*)" "Bash(npm run check:spec*)" "Bash(npm run synth*)"
  "Bash(npx vitest*)" "Bash(npx tsc*)" "Bash(npx eslint*)"
  "Bash(git diff*)" "Bash(git show*)" "Bash(git log*)" "Bash(git status*)"
  "Bash(ls *)" "Bash(ls)" "Bash(cat *)" "Bash(head *)" "Bash(tail *)" "Bash(grep *)" "Bash(find *)" "Bash(wc *)"
)
REVIEW_DENIED=(Edit Write MultiEdit NotebookEdit WebFetch WebSearch Agent "Bash(git push*)" "Bash(git commit*)" "Bash(git add*)")

impl_cmd() { # $1 = ID
  local cmd=(claude -p "Lee AGENTS.md y ejecuta $1. Detente según las reglas de autoridad."
    --permission-mode dontAsk --output-format stream-json --verbose
    --allowedTools "${IMPL_ALLOWED[@]}" --disallowedTools "${IMPL_DENIED[@]}")
  [ -n "${NIGHT_IMPL_MODEL:-}" ] && cmd+=(--model "$NIGHT_IMPL_MODEL")
  [ -n "${NIGHT_MAX_USD:-}" ] && cmd+=(--max-budget-usd "$NIGHT_MAX_USD")
  printf '%q ' "${cmd[@]}"
}

case "$REVIEWER" in
  codex) command -v codex >/dev/null || die "NIGHT_REVIEWER=codex pero codex no está en PATH"; REVIEWER_KIND=codex ;;
  claude) REVIEWER_KIND=claude ;;
  auto) if command -v codex >/dev/null; then REVIEWER_KIND=codex; else REVIEWER_KIND=claude; fi ;;
  *) die "NIGHT_REVIEWER inválido: $REVIEWER (auto|codex|claude)" ;;
esac

review_cmd() { # imprime la orden del revisor; lee el prompt por stdin
  local cmd
  if [ "$REVIEWER_KIND" = codex ]; then
    cmd=(codex exec --sandbox read-only -C "$ROOT" --ephemeral --color never -o "$RUN_DIR/REVIEW-last.txt" -)
    [ -n "${NIGHT_REVIEW_MODEL:-}" ] && cmd+=(--model "$NIGHT_REVIEW_MODEL")
  else
    cmd=(claude -p --permission-mode dontAsk --output-format text
      --allowedTools "${REVIEW_ALLOWED[@]}" --disallowedTools "${REVIEW_DENIED[@]}")
    [ -n "${NIGHT_REVIEW_MODEL:-}" ] && cmd+=(--model "$NIGHT_REVIEW_MODEL")
    [ -n "${NIGHT_MAX_USD:-}" ] && cmd+=(--max-budget-usd "$NIGHT_MAX_USD")
  fi
  printf '%q ' "${cmd[@]}"
}

# ---------- Prompt del revisor (sdd.md §7.5) ----------
review_prompt() { # $1 = ID; escribe el prompt completo en stdout
  local id=$1 commits diff_file
  diff_file=$RUN_DIR/$id-diff.patch
  commits=$(git log --reverse --format=%H -E --grep="^Task:[[:space:]]*$id([[:space:],]|$)")
  : >"$diff_file"
  local sha
  for sha in $commits; do
    git show --stat --patch --format='commit %h · %s%n%b' "$sha" >>"$diff_file"
    printf '\n' >>"$diff_file"
  done
  cat <<EOF
Eres un revisor independiente con contexto limpio. No participaste en la implementación y no debes confiar en lo que
afirme el implementador: solo cuenta lo que ves en el diff y lo que puedas ejecutar.

Recibes únicamente: (a) la tarea $id con los requisitos (REQ) que cita, (b) las decisiones aceptadas (DEC) que cita y
(c) el diff de los commits de la tarea. Responde tres preguntas:
  1. ¿Cada requisito está implementado y probado, incluidos los bordes?
  2. ¿Cambió algo fuera del alcance de la tarea?
  3. ¿Se violó una decisión aceptada?

Reglas:
- Excluye explícitamente estilo y preferencias. No propongas refactors ni mejoras.
- Cada hallazgo debe citar un REQ-NNN o una DEC-NNN. Un hallazgo sin cita no bloquea (puedes mencionarlo en "notes").
- Confirma cada hallazgo bloqueante ejecutando algo (una prueba, un comando) antes de emitirlo. Si no pudiste
  ejecutarlo, dilo en el hallazgo. El repositorio está en $ROOT en modo solo lectura: puedes correr
  \`npm test\`, \`npm run lint\`, \`npm run typecheck\`, \`npm run check:spec\` y \`git show <sha>\`.
- No modifiques ningún archivo. No hagas commits.
- El veredicto es "rejected" solo si existe al menos un hallazgo bloqueante con cita; si no, "approved".

Termina tu respuesta con exactamente un bloque de código JSON con esta forma (sin texto después del bloque):
\`\`\`json
{"verdict": "approved" | "rejected", "findings": ["REQ-00X: …", "DEC-00X: …"], "notes": "observaciones no bloqueantes"}
\`\`\`

$(tasks context "$id")

# Commits de la tarea
$(for sha in $commits; do git show -s --format='%h %s' "$sha"; done)

# Diff
$(head -c 400000 "$diff_file")
$( [ "$(wc -c <"$diff_file")" -gt 400000 ] && echo "… (diff truncado a 400 KB; usa git show <sha> para ver el resto)" )
EOF
}

# ---------- Bitácora ----------
append_log() { # $1 = encabezado-agente, resto en stdin
  { printf '\n## %s · %s\n' "$(now_stamp)" "$1"; cat; } >>"$ROOT/spec/LOG.md"
}

commit_spec() { # $1 = asunto, $2 = Task, $3 = Req
  git add spec/TASKS.json spec/LOG.md
  git commit -q -m "$1" -m "Task: $2
Req: $3
Co-Authored-By: night-loop <noreply@local>"
  git_head
}

write_summary() {
  local elapsed=$((($(date +%s) - START) / 60))
  local hecho verificado
  hecho=$(printf '%s; ' "${SUMMARY[@]:-nada}"); hecho=${hecho%; }
  verificado=$(printf '%s; ' "${VERIFIED[@]:-sin comandos ejecutados}"); verificado=${verificado%; }
  local tokens
  tokens=$(tokens_summary | paste -sd ';' | sed 's/;/; /g')
  log "tokens (implementador): $tokens"
  local body
  body=$(cat <<EOF
- Hecho: ${hecho}. Corrida ${RUN_ID} (${elapsed} min, ${TASKS_DONE} tarea(s) completada(s), ${FAILURES} fallo(s)); registros en .night-loop/${RUN_ID}/.
- Tokens (implementador, campo usage del evento result): ${tokens}.
- Verificado y cómo: ${verificado}.
- En curso / roto: $(git status --porcelain | grep -q . && echo "árbol de trabajo sucio (ver git status)" || echo "árbol limpio en $(git_head)").
- Bloqueos nuevos: $(node -e 'const d=require(process.argv[1]);const b=d.tasks.filter(t=>t.status==="blocked").map(t=>`${t.id} (${t.blocked_by})`);console.log(b.length?b.join(", "):"ninguno")' "$ROOT/spec/TASKS.json").
- Motivo de parada: ${STOP_REASON}.
- Próxima acción autorizada: el usuario revisa este resumen, los veredictos registrados en TASKS.json y los registros de la corrida; decide accepted o devuelve la tarea. El orquestador no marca accepted ni hace push.
EOF
)
  if [ "$DRY_RUN" = 1 ]; then
    echo; echo "== Entrada que se anotaría en spec/LOG.md (no escrita: --dry-run) =="
    printf '## %s · night-loop (scripts/night-loop.sh)\n%s\n' "$(now_stamp)" "$body"
    return
  fi
  local dirty=0
  git status --porcelain | grep -q . && dirty=1
  printf '%s\n' "$body" | append_log "night-loop (scripts/night-loop.sh)"
  if [ "$dirty" = 1 ]; then
    log "resumen anotado en spec/LOG.md SIN commit: el árbol ya estaba sucio y nada se confirma a ciegas (git status)"
    return
  fi
  local sha
  sha=$(commit_spec "Orquestador nocturno: resumen de la corrida $RUN_ID" "T-08" "N/A") || die "no se pudo confirmar el resumen en LOG.md; revisa git status"
  log "resumen anotado en spec/LOG.md (commit $sha)"
}

# ---------- Revisión independiente ----------
review_task() { # $1 = ID; devuelve 0 si hubo veredicto
  local id=$1 kind out prompt_file verdict_file
  prompt_file=$RUN_DIR/$id-review-prompt.md verdict_file=$RUN_DIR/$id-verdict.json
  kind=$REVIEWER_KIND
  review_prompt "$id" >"$prompt_file"
  log "revisor ($kind) sobre $id: $(wc -c <"$prompt_file") bytes de contexto"
  out=$RUN_DIR/$id-review-output.txt
  local rc=0 t
  t=$(remaining); [ "$t" -lt 600 ] && t=600   # una tarea terminada siempre se revisa (mín. 10 min)
  # shellcheck disable=SC2046
  eval timeout -k 30 "$t" "$(review_cmd)" <"$prompt_file" >"$out" 2>"$RUN_DIR/$id-review.err" || rc=$?
  [ "$kind" = codex ] && [ -s "$RUN_DIR/REVIEW-last.txt" ] && cp "$RUN_DIR/REVIEW-last.txt" "$out"
  if [ "$rc" -ne 0 ] && [ ! -s "$out" ]; then
    STOP_REASON="el revisor ($kind) terminó con código $rc sin salida (ver $RUN_DIR/$id-review.err)"; ABNORMAL=1
    return 1
  fi
  if ! tasks parse-verdict "$out" >"$verdict_file"; then
    STOP_REASON="el revisor ($kind) no entregó un veredicto JSON válido (ver $out)"; ABNORMAL=1
    return 1
  fi
  local label
  if [ "$kind" = codex ]; then label="codex exec $(codex --version 2>/dev/null | head -1)"; else label="claude -p $(claude --version 2>/dev/null | head -1)"; fi
  node -e '
    const fs=require("fs");const [f,label]=process.argv.slice(1);
    const v=JSON.parse(fs.readFileSync(f,"utf8"));v.reviewer=label+" (contexto limpio, night-loop)";
    fs.writeFileSync(f,JSON.stringify(v,null,2));' "$verdict_file" "$label"
  local verdict new_status findings
  verdict=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).verdict)' "$verdict_file")
  findings=$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(v.findings.length?v.findings.join(" | "):"sin hallazgos bloqueantes")' "$verdict_file")
  new_status=$(tasks set-review "$id" "$verdict_file")
  log "veredicto sobre $id: $verdict → estado $new_status"
  local reqs
  reqs=$(node -e 'const t=require(process.argv[1]).tasks.find(t=>t.id===process.argv[2]);console.log(t.reqs.length?t.reqs.join(", "):(t.kind==="tooling"?"N/A":"none"))' "$ROOT/spec/TASKS.json" "$id")
  append_log "revisor independiente ($label) vía night-loop" <<EOF
- Hecho: revisión independiente de $id con contexto limpio (solo diff + REQ/DEC de la tarea). Veredicto: **$verdict** → estado \`$new_status\`. Hallazgos: $findings.
- Verificado y cómo: veredicto completo en TASKS.json (\`review\` de $id); salida íntegra en .night-loop/$RUN_ID/$id-review-output.txt.
- Próxima acción autorizada: continúa el orquestador nocturno; el usuario decide accepted por la mañana.
EOF
  local sha
  sha=$(commit_spec "$id: revisión independiente ($verdict)" "$id" "$reqs") || { STOP_REASON="no se pudo confirmar el veredicto de $id"; ABNORMAL=1; return 1; }
  SUMMARY+=("$id revisada por $kind: $verdict → $new_status (commit $sha)")
  return 0
}

# ---------- Implementación ----------
run_task() { # $1 = ID, $2 = intento; devuelve 0 si la tarea avanzó, 1 si falló, 2 si hay que detenerse
  local id=$1 attempt=$2 head_before rc=0 status before
  before=$RUN_DIR/$id-before-$attempt.json
  tasks snapshot >"$before"
  head_before=$(git_head)
  log "implementador sobre $id (intento $attempt, $(remaining) s restantes)"
  # Flujo stream-json → líneas legibles en la terminal y live.log; copia íntegra en .jsonl, evento final en .json.
  set +e
  # shellcheck disable=SC2046
  eval timeout -k 30 "$(remaining)" "$(impl_cmd "$id")" 2>"$RUN_DIR/$id-impl-$attempt.err" \
    | node "$ROOT/scripts/lib/night-stream.mjs" --label "$id" \
        --raw "$RUN_DIR/$id-impl-$attempt.jsonl" --result "$RUN_DIR/$id-impl-$attempt.json" --tokens "$TOKENS" \
    | tee -a "$LIVE"
  rc=${PIPESTATUS[0]}
  set -e
  log "  $(node --input-type=module -e '
    import fs from "fs";const {usageOf,formatUsage}=await import(process.argv[3]);
    try{const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    fs.writeFileSync(process.argv[2],(r.result??"")+"\n");const u=usageOf(r);
    console.log(`turnos=${r.num_turns} tokens: ${u?formatUsage(u):"sin usage"} error=${r.is_error}`)}catch{console.log("(salida no JSON)")}' \
    "$RUN_DIR/$id-impl-$attempt.json" "$RUN_DIR/$id-impl-$attempt.txt" "$ROOT/scripts/lib/night-stream.mjs" </dev/null)"
  log "tokens de $id en la corrida: $(tokens_summary | grep "^$id: " | sed "s/^$id: //" || echo "sin usage")"
  status=$(tasks status "$id" 2>/dev/null || echo "?")
  log "implementador terminó (código $rc); $id → $status; HEAD $head_before → $(git_head)"

  if git status --porcelain | grep -q .; then
    STOP_REASON="árbol de trabajo sucio tras el implementador en $id (nada se descarta; revisar a mano)"; ABNORMAL=1
    return 2
  fi
  if ! tasks check-authority "$before"; then
    STOP_REASON="el implementador otorgó un estado reservado en $id (violación de autoridad; revisar a mano)"; ABNORMAL=1
    return 2
  fi
  case "$status" in
    blocked)
      STOP_REASON="$id quedó blocked ($(node -e 'console.log(require(process.argv[1]).tasks.find(t=>t.id===process.argv[2]).blocked_by)' "$ROOT/spec/TASKS.json" "$id"))"
      SUMMARY+=("$id bloqueada por el implementador"); ABNORMAL=1
      return 2 ;;
    verified_auto|done)
      if ! npm run -s check:spec >"$RUN_DIR/$id-check-spec.txt" 2>&1; then
        SUMMARY+=("$id quedó $status pero check:spec falla")
        VERIFIED+=("npm run check:spec tras $id → falla (ver .night-loop/$RUN_ID/$id-check-spec.txt)")
        return 1
      fi
      VERIFIED+=("npm run check:spec tras $id → ok")
      SUMMARY+=("$id implementada ($head_before..$(git_head), estado $status)")
      return 0 ;;
    *)
      [ "$rc" -eq 124 ] && SUMMARY+=("$id: el implementador agotó el tiempo (estado $status)") || SUMMARY+=("$id: el implementador terminó en $status (código $rc)")
      return 1 ;;
  esac
}

review_pending() { # revisa las tareas en verified_auto aún no revisadas en esta corrida; 1 = detenerse
  local id
  for id in $(tasks pending-reviews | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).join(" "))'); do
    case "$REVIEWED_IDS" in *" $id "*) continue ;; esac
    if [ "$(remaining)" -lt 600 ]; then STOP_REASON="presupuesto de tiempo agotado antes de revisar $id (quedan $(remaining)s)"; return 1; fi
    REVIEWED_IDS="$REVIEWED_IDS$id "
    log "$id espera revisión independiente (verified_auto): se revisa antes de elegir tarea nueva"
    review_task "$id" || return 1
  done
  return 0
}

# ---------- Precondiciones ----------
command -v claude >/dev/null || die "claude no está en PATH"
command -v timeout >/dev/null || die "falta coreutils timeout"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "no es un repositorio git"
if git status --porcelain | grep -q .; then
  [ "$DRY_RUN" = 1 ] || die "árbol de trabajo sucio; confirma o guarda los cambios antes de la corrida nocturna"
  echo "night-loop: aviso: árbol de trabajo sucio (una corrida real se detendría aquí)" >&2
fi
mkdir -p "$ROOT/.night-loop" && printf '*\n' >"$ROOT/.night-loop/.gitignore"   # registros fuera de git
exec 9>"$ROOT/.night-loop/lock"
flock -n 9 || die "otra corrida nocturna está en marcha (.night-loop/lock)"
mkdir -p "$RUN_DIR"

[ -n "$AWS_KEY_ID" ] || echo "night-loop: aviso: sin perfil [$NIGHT_AWS_PROFILE] en $AWS_SOURCE; aceptación y humo fallarán por credenciales" >&2
log "inicio en $(git_head) (rama $(git rev-parse --abbrev-ref HEAD)); presupuesto ${BUDGET}s, máx. ${MAX_TASKS} tareas, máx. ${MAX_FAILURES} fallos; revisor: $REVIEWER_KIND"
if [ "$DRY_RUN" = 1 ]; then
  echo
  echo "== Ensayo (--dry-run): no se lanza claude/codex, no se escribe LOG.md ni se hacen commits =="
  echo "Guardas de entorno: AWS_PROFILE=$AWS_PROFILE ($( [ -n "$AWS_KEY_ID" ] && echo "llave $AWS_KEY_ID" || echo "SIN llaves en $AWS_SOURCE"); único perfil en AWS_CONFIG_FILE/AWS_SHARED_CREDENTIALS_FILE temporales) AWS_EC2_METADATA_DISABLED=$AWS_EC2_METADATA_DISABLED"
  echo "Remotos con push anulado: $(git remote | tr '\n' ' ')${GIT_CONFIG_COUNT:+(GIT_CONFIG_COUNT=$GIT_CONFIG_COUNT)}$( [ -z "$(git remote)" ] && echo '(ninguno configurado)')"
  echo
fi

# ---------- Ciclo ----------
RETRY=""
while :; do
  if [ "$(remaining)" -lt 600 ]; then STOP_REASON="presupuesto de tiempo agotado (${BUDGET}s; quedan $(remaining)s, menos de 10 min)"; break; fi
  if [ "$TASKS_DONE" -ge "$MAX_TASKS" ]; then STOP_REASON="presupuesto de tareas alcanzado ($MAX_TASKS)"; break; fi
  if [ "$FAILURES" -ge "$MAX_FAILURES" ]; then STOP_REASON="$FAILURES fallos (tope $MAX_FAILURES)"; ABNORMAL=1; break; fi

  if [ "$DRY_RUN" = 1 ]; then
    pending=$(tasks pending-reviews | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).join(" "))')
    echo "Revisiones pendientes antes de elegir tarea (verified_auto, revisor $REVIEWER_KIND): ${pending:-ninguna}"
    for id in $pending; do SUMMARY+=("(ensayo) $id se habría revisado"); done
  else
    review_pending || break
  fi

  if [ -n "$RETRY" ]; then pick=$(tasks pick --task "$RETRY"); RETRY=""
  elif [ -n "$FORCED_TASK" ]; then pick=$(tasks pick --task "$FORCED_TASK"); FORCED_TASK=""
  else pick=$(tasks pick); fi
  if [ "$pick" = null ]; then STOP_REASON="no hay tareas ready/approved_for_impl con dependencias cerradas"; break; fi
  ID=$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$pick")
  TITLE=$(node -e 'console.log(JSON.parse(process.argv[1]).title)' "$pick")

  if [ "$DRY_RUN" = 1 ]; then
    echo "Tarea elegida: $ID — $TITLE"
    echo "  $(node -e 'const p=JSON.parse(process.argv[1]);console.log(`estado ${p.status}, kind ${p.kind}, reqs [${p.reqs}], decisions [${p.decisions}]`)' "$pick")"
    echo "Implementador (desde $ROOT, timeout $(remaining)s):"
    echo "  $(impl_cmd "$ID")"
    echo "Tras el implementador: exige árbol limpio, check-authority (sin reviewed/accepted/approved_for_impl/delivered otorgados), npm run check:spec."
    echo "Revisor si queda verified_auto/done ($REVIEWER_KIND), con prompt §7.5 + REQ/DEC + diff de commits 'Task: $ID' por stdin:"
    echo "  $(review_cmd)"
    echo "  contexto REQ/DEC que recibiría: $(tasks context "$ID" | wc -c) bytes; commits previos de la tarea: $(git log --format=%h -E --grep="^Task:[[:space:]]*$ID([[:space:],]|$)" | tr '\n' ' ')"
    SUMMARY+=("(ensayo) $ID se habría ejecutado")
    STOP_REASON="ensayo: se detiene tras planificar la primera tarea"
    break
  fi

  if run_task "$ID" $((FAILURES + 1)); then
    TASKS_DONE=$((TASKS_DONE + 1))
    REVIEWED_IDS="$REVIEWED_IDS$ID "
    review_task "$ID" || break
  else
    rc=$?
    [ "$rc" -eq 2 ] && break
    FAILURES=$((FAILURES + 1))
    log "fallo $FAILURES/$MAX_FAILURES en $ID"
    [ "$FAILURES" -lt "$MAX_FAILURES" ] && RETRY=$ID
  fi
done

log "parada: $STOP_REASON"
write_summary
[ "$DRY_RUN" = 1 ] && rmdir "$RUN_DIR" 2>/dev/null
exit "$ABNORMAL"   # 1 si la parada requiere intervención
