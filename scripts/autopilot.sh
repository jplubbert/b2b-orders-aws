#!/usr/bin/env bash
# Orquestador nocturno (T-08). Ejecuta tareas del protocolo PCR sin supervisión, dentro de un presupuesto.
#
#   scripts/autopilot.sh [--dry-run] [--task T-NN] [--max-tasks N] [--budget-seconds N] [--max-failures N]
#
# Ciclo:
#   0. Antes de elegir tarea nueva, revisa cada tarea en verified_auto (p. ej. implementada en una sesión interactiva)
#      con el mismo revisor y mecanismo del paso 3; cada una se revisa una sola vez por corrida (un rechazo la deja
#      en verified_auto y no se repite hasta la próxima corrida).
#   1. Elige la primera tarea "in_progress" (la retoma), "ready" o "approved_for_impl" de spec/TASKS.json con todas sus dependencias cerradas
#      (done/accepted/delivered, o reviewed: así encadena tareas sin esperar la aceptación del usuario).
#      Si no hay, anota en spec/LOG.md y termina.
#   2. Lanza el implementador: `claude -p "Lee AGENTS.md y ejecuta <ID>. Detente según las reglas de autoridad. …"`
#      (el prompt pide además `npm run test:acceptance` sin prefijos de entorno, comandos simples sin && ni cd, y
#      "Pendiente deploy" en vez de desplegar; ver IMPL_PROMPT)
#      con permisos acotados al repositorio (sin red, sin push, sin instalar nada fuera de npm; AWS solo con el perfil
#      `autopilot` para `npm run test:acceptance` y `npm run smoke`). Progreso en vivo (stream-json → líneas legibles)
#      en la terminal y en .autopilot/<corrida>/live.log (`tail -f` desde otra terminal). Tokens de cada invocación
#      (entrada, salida, caché leída y escrita, del campo `usage` del evento `result`) por tarea y total de la corrida
#      en la terminal, live.log y el resumen de LOG.md; el revisor no se cuenta (codex/claude en texto no los informan).
#   3. Si la tarea queda verified_auto (o done), lanza un revisor con contexto limpio (`codex exec`, o `claude -p`
#      si no hay codex) con el prompt de sdd.md §7.5, solo sobre el diff de la tarea y sus REQ/DEC. El veredicto va a
#      TASKS.json (`review`; approved → reviewed) y a LOG.md.
#      Si el implementador termina bien (código 0) sin cambios (mismo HEAD y mismo estado), o deja la tarea
#      in_progress con una línea "- Pendiente deploy:" nueva en LOG.md (que no diga "ninguno", "nada", "N/A"…), no es
#      un fallo ni se reintenta: la tarea se salta en esta corrida y se elige la siguiente independiente. Lo mismo si
#      una tarea de spec queda in_progress con commits nuevos: espera que el usuario apruebe el diff de tests/acceptance/.
#      Si lo único pendiente es una verificación manual en el teléfono, el implementador deja la tarea verified_auto
#      con `evidence.manual_pending` (DEC-011); el resumen de LOG.md lista esas verificaciones en "Pendiente manual".
#      Los fallos se cuentan por tarea: tras el primero se reintenta la misma; con dos (AUTOPILOT_MAX_FAILURES) se
#      abandona en esta corrida y se sigue con la siguiente independiente (la corrida termina con código 1).
#   4. Se detiene si la tarea queda blocked, si vence el presupuesto (6 h), si completa 10 tareas o si no quedan
#      tareas elegibles.
#      Siempre deja un resumen en LOG.md (y lo confirma con Task: T-08 / Req: N/A, salvo que el árbol quede sucio).
#      Código de salida 1 si la parada requiere intervención (blocked, fallos, violación de autoridad, sin veredicto).
#   5. Nunca hace push, nunca despliega a AWS ni marca accepted/reviewed por su cuenta (reviewed solo con veredicto).
#   6. Al detenerse (también si se cae), si hay NTFY_TOPIC envía un aviso a $NTFY_URL/$NTFY_TOPIC (T-21): motivo de
#      parada, tareas hechas/fallidas y próxima acción. Prioridad alta y tag de alerta si requiere intervención
#      (bloqueo, fallo, rechazo del revisor, límite de presupuesto, despliegue o aprobación pendiente); normal si
#      terminó bien. Si ntfy falla
#      solo se anota en el registro: la corrida no cambia su resultado. En --dry-run muestra el aviso sin enviarlo.
#
# Guardas mecánicas sobre los procesos hijos: solo el perfil AWS `autopilot` (usuario IAM autopilot-tests, DEC-010/DEC-015:
# datos de la tabla y admin del user pool de PedidosB2B-dev) copiado a un AWS_CONFIG_FILE/AWS_SHARED_CREDENTIALS_FILE
# temporales, así que `default` no existe para ellos (deploy/bootstrap/cdk fallan además por permisos); pushurl de
# todos los remotos apuntado a una ruta inexistente, herramientas de red y despliegue denegadas al implementador,
# y comprobación tras cada tarea de que el ejecutor no otorgó estados reservados (reviewed/accepted/…).
#
# Variables: AUTOPILOT_MAX_TASKS (10), AUTOPILOT_BUDGET_SECONDS (21600), AUTOPILOT_MAX_FAILURES (2, por tarea), AUTOPILOT_REVIEWER (auto|codex|claude),
#            AUTOPILOT_IMPL_MODEL, AUTOPILOT_REVIEW_MODEL, AUTOPILOT_MAX_USD (tope por invocación de claude, opcional),
#            AUTOPILOT_AWS_PROFILE (autopilot), AUTOPILOT_AWS_CREDENTIALS (origen de las llaves; ~/.aws/credentials),
#            NTFY_TOPIC (sin valor: no se avisa), NTFY_URL (https://ntfy.sh), AUTOPILOT_NTFY_MAX (3000, largo del aviso).
# Configuración local: AUTOPILOT_CONFIG (por defecto ~/.config/autopilot/autopilot.config.sh, fuera del repo porque el
# tema de ntfy es secreto: quien lo conoce lee los avisos). Es un script de bash que puede fijar cualquiera de las
# variables anteriores, p. ej. `NTFY_TOPIC=autopilot-xxxxxxxx`. Las variables no se pasan a los procesos hijos.
# Registros de cada corrida: .autopilot/<fecha>/ (fuera de git).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

# ---------- Configuración local (fuera de git) ----------
AUTOPILOT_CONFIG=${AUTOPILOT_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/autopilot/autopilot.config.sh}
NTFY_TOPIC=${NTFY_TOPIC:-}
# shellcheck disable=SC1090
if [ -r "$AUTOPILOT_CONFIG" ]; then . "$AUTOPILOT_CONFIG"; fi
NTFY_URL=${NTFY_URL:-https://ntfy.sh}
export -n NTFY_TOPIC NTFY_URL 2>/dev/null || true   # el tema no llega al implementador ni al revisor

MAX_TASKS=${AUTOPILOT_MAX_TASKS:-10}
BUDGET=${AUTOPILOT_BUDGET_SECONDS:-21600}
MAX_FAILURES=${AUTOPILOT_MAX_FAILURES:-2}
REVIEWER=${AUTOPILOT_REVIEWER:-auto}
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
    *) echo "autopilot: argumento desconocido: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

tasks() { node "$ROOT/scripts/lib/autopilot-tasks.mjs" --root "$ROOT" "$@"; }
RUN_ID=$(date '+%Y-%m-%d_%H%M%S')
RUN_DIR="$ROOT/.autopilot/$RUN_ID"
LIVE="$RUN_DIR/live.log"
TOKENS="$RUN_DIR/tokens.jsonl"   # una línea por invocación del implementador (autopilot-stream.mjs --tokens)
START=$(date +%s)
DEADLINE=$((START + BUDGET))
SUMMARY=()        # líneas "Hecho" del resumen
VERIFIED=()       # líneas "Verificado y cómo"
STOP_REASON=""
ABNORMAL=0       # 1 = parada que requiere intervención (blocked, fallos, violación, árbol sucio, sin veredicto)
TASKS_DONE=0
FAILURES=0        # total de la corrida (para el resumen); el tope se aplica por tarea (FAILS)
declare -A FAILS=()
DEPLOY_PENDING=() # tareas que esperan un despliegue del usuario
REVIEWED_IDS=" "  # tareas ya revisadas en esta corrida (no se revisan dos veces)
SKIPPED=""        # tareas que el implementador dejó sin cambios (separadas por comas; no se vuelven a elegir)
ABANDONED=()      # tareas abandonadas por el tope de fallos
USER_WAIT=()      # tareas de spec que esperan la aprobación del usuario
REJECTED=()       # tareas que el revisor rechazó en esta corrida
NOTIFIED=0        # 1 = el aviso ntfy de la parada ya se intentó

log() { # a la terminal y, en una corrida real, a live.log
  local line; line=$(printf '%s autopilot: %s' "$(date '+%H:%M:%S')" "$*")
  printf '%s\n' "$line"
  if [ "$DRY_RUN" = 0 ] && [ -d "$RUN_DIR" ]; then printf '%s\n' "$line" >>"$LIVE"; fi
  return 0
}
die() { echo "autopilot: $*" >&2; exit 1; }
tokens_summary() { node "$ROOT/scripts/lib/autopilot-stream.mjs" tokens-summary "$TOKENS"; }
remaining() { echo $((DEADLINE - $(date +%s))); }
now_stamp() { date '+%Y-%m-%d %H:%M'; }
git_head() { git rev-parse --short HEAD; }
# ¿Hay una línea "- Pendiente deploy:" nueva en LOG.md desde $1 que pida algo? "ninguno", "nada", "N/A"… no cuentan.
deploy_pending_since() {
  git diff "$1" HEAD -- spec/LOG.md | grep -E '^\+- Pendiente deploy:' \
    | grep -qviE '^\+- Pendiente deploy:[[:space:]]*(ningun[oa]?|nada|no aplica|n/?a|—|-)([[:space:].,;:()]|$)'
}

# ---------- Aviso ntfy al detenerse (T-21) ----------
ntfy_send() { # $1 = prioridad (high|default), $2 = tags, $3 = título, $4 = mensaje. Nunca falla.
  NOTIFIED=1
  [ -n "$NTFY_TOPIC" ] || return 0
  if [ "$DRY_RUN" = 1 ]; then
    printf '\n== Aviso ntfy que se enviaría (no enviado: --dry-run; prioridad %s, tags %s) ==\n%s\n%s\n' "$1" "$2" "$3" "$4"
    return 0
  fi
  local err=/dev/null rc=0
  [ -d "$RUN_DIR" ] && err="$RUN_DIR/ntfy.err"
  curl -fsS --max-time 15 -o /dev/null -H "Title: $3" -H "Priority: $1" -H "Tags: $2" \
    --data-binary "$4" "$NTFY_URL/$NTFY_TOPIC" 2>>"$err" || rc=$?
  if [ "$rc" = 0 ]; then log "aviso ntfy enviado (prioridad $1)"
  else log "aviso: ntfy falló (código $rc); la corrida no cambia su resultado"; fi
  return 0
}
short_list() { # lista de tareas acotada para el aviso: las 5 primeras y "… (+N más)"
  local n=$#
  if [ "$n" -le 5 ]; then printf '%s' "$*"; else printf '%s … (+%s más)' "${*:1:5}" "$((n - 5))"; fi
}
ntfy_body() { # $1 = motivo, $2 = próxima acción. Nunca pasa de AUTOPILOT_NTFY_MAX caracteres (3000; ntfy admite 4096
  # bytes): la próxima acción va al final y se conserva; lo anterior (detalle, corrida, hechas/fallidas, motivo) se
  # recorta desde el final.
  local max=${AUTOPILOT_NTFY_MAX:-3000}
  local fallidas="${FAILURES} fallo(s)"
  [ "${#ABANDONED[@]}" -gt 0 ] && fallidas+="; abandonadas: $(short_list "${ABANDONED[@]}")"
  [ "${#REJECTED[@]}" -gt 0 ] && fallidas+="; rechazadas por el revisor: $(short_list "${REJECTED[@]}")"
  local detail; detail=$(printf '%s; ' "${SUMMARY[@]:-nada}"); detail=${detail%; }
  local next="Próxima acción: $2"
  [ "${#next}" -gt "$max" ] && next="${next:0:$((max - 1))}…"
  local rest
  rest=$(printf 'Motivo de parada: %s\nHechas: %s tarea(s) · Fallidas: %s\nCorrida %s (registros en .autopilot/%s/)\nDetalle: %s' \
    "$1" "$TASKS_DONE" "$fallidas" "$RUN_ID" "$RUN_ID" "$detail")
  local room=$((max - ${#next} - 1))
  if [ "$room" -le 1 ]; then printf '%s' "$next"; return 0; fi
  [ "${#rest}" -gt "$room" ] && rest="${rest:0:$((room - 1))}…"
  printf '%s\n%s' "$rest" "$next"
}
notify_stop() { # aviso de la parada normal (tras write_summary)
  local repo intervention=0 next
  repo=$(basename "$ROOT")
  [ "$ABNORMAL" = 1 ] && intervention=1
  case "$STOP_REASON" in presupuesto*) intervention=1 ;; esac
  [ "${#DEPLOY_PENDING[@]}" -gt 0 ] && intervention=1
  [ "${#USER_WAIT[@]}" -gt 0 ] && intervention=1
  [ "${#REJECTED[@]}" -gt 0 ] && intervention=1
  if [ "$(node -e 'console.log(require(process.argv[1]).tasks.some(t=>t.status==="blocked"))' "$ROOT/spec/TASKS.json")" = true ]; then
    intervention=1; next="resolver el bloqueo (${STOP_REASON}) y relanzar el autopilot"
  elif [ "${#ABANDONED[@]}" -gt 0 ]; then next="revisar los fallos de $(short_list "${ABANDONED[@]}") en .autopilot/${RUN_ID}/ y relanzar"
  elif [ "${#REJECTED[@]}" -gt 0 ]; then next="atender los hallazgos del revisor (review de $(short_list "${REJECTED[@]}") en spec/TASKS.json)"
  elif [ "$ABNORMAL" = 1 ]; then next="revisar a mano: ${STOP_REASON}"
  elif [ "${#DEPLOY_PENDING[@]}" -gt 0 ]; then next="correr npm run deploy:dev ($(short_list "${DEPLOY_PENDING[@]}")) y relanzar el autopilot"
  elif [ "${#USER_WAIT[@]}" -gt 0 ]; then next="aprobar el diff de tests/acceptance/ de $(short_list "${USER_WAIT[@]}")"
  elif [ "$intervention" = 1 ]; then next="relanzar el autopilot para seguir (límite alcanzado)"
  else next="revisar el resumen en spec/LOG.md y los veredictos en TASKS.json; decidir accepted"; fi
  local msg; msg=$(ntfy_body "$STOP_REASON" "$next")
  if [ "$intervention" = 1 ]; then ntfy_send high warning,rotating_light "autopilot $repo: requiere tu intervención" "$msg"
  else ntfy_send default white_check_mark "autopilot $repo: terminó bien" "$msg"; fi
}
on_exit() { # $1 = código de salida; si la corrida se cae antes del aviso normal, avisa igual
  rm -rf "${AWS_SANDBOX:-}"
  if [ "$NOTIFIED" = 0 ] && [ "$1" != 0 ]; then
    ntfy_send high warning,rotating_light "autopilot $(basename "$ROOT"): se detuvo inesperadamente" \
      "$(ntfy_body "el autopilot terminó con código $1 antes de anotar su resumen${STOP_REASON:+ ($STOP_REASON)}" \
        "revisar la terminal, .autopilot/${RUN_ID}/ (live.log, ntfy.err) y git status; relanzar el autopilot")"
  fi
}

# ---------- Guardas de entorno (heredadas por claude/codex y todo lo que lancen) ----------
export AUTOPILOT=1
export CI=1
# AWS: solo el perfil autopilot (DEC-010, DEC-015), copiado a archivos temporales; default y el resto no existen para los hijos.
AUTOPILOT_AWS_PROFILE=${AUTOPILOT_AWS_PROFILE:-autopilot}
AWS_SOURCE=${AUTOPILOT_AWS_CREDENTIALS:-${AWS_SHARED_CREDENTIALS_FILE:-$HOME/.aws/credentials}}
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE AWS_DEFAULT_REGION
AWS_SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/autopilot-aws.XXXXXX")
trap 'on_exit $?' EXIT
aws_profile_key() { # $1 = clave; lee la sección [$AUTOPILOT_AWS_PROFILE] del archivo de credenciales de origen
  [ -r "$AWS_SOURCE" ] || return 0
  awk -v sec="[$AUTOPILOT_AWS_PROFILE]" -v key="$1" '
    /^[[:space:]]*\[/ { gsub(/[[:space:]]/, ""); inside = ($0 == sec); next }
    inside { split($0, kv, "="); k = kv[1]; gsub(/[[:space:]]/, "", k)
             if (k == key) { v = substr($0, index($0, "=") + 1); gsub(/^[[:space:]]+|[[:space:]]+$/, "", v); print v; exit } }' "$AWS_SOURCE"
}
AWS_KEY_ID=$(aws_profile_key aws_access_key_id)
( umask 077
  printf '[profile %s]\nregion = us-east-1\n' "$AUTOPILOT_AWS_PROFILE" >"$AWS_SANDBOX/config"
  if [ -n "$AWS_KEY_ID" ]; then
    printf '[%s]\naws_access_key_id = %s\naws_secret_access_key = %s\n' \
      "$AUTOPILOT_AWS_PROFILE" "$AWS_KEY_ID" "$(aws_profile_key aws_secret_access_key)" >"$AWS_SANDBOX/credentials"
  else
    : >"$AWS_SANDBOX/credentials"
  fi )
export AWS_CONFIG_FILE=$AWS_SANDBOX/config AWS_SHARED_CREDENTIALS_FILE=$AWS_SANDBOX/credentials
export AWS_PROFILE=$AUTOPILOT_AWS_PROFILE AWS_REGION=us-east-1 AWS_EC2_METADATA_DISABLED=true
n=0
for remote in $(git remote); do
  export "GIT_CONFIG_KEY_${n}=remote.${remote}.pushurl" "GIT_CONFIG_VALUE_${n}=/nonexistent/autopilot-sin-push"
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

IMPL_PROMPT='Lee AGENTS.md y ejecuta %s. Detente según las reglas de autoridad. Corre `npm run test:acceptance` y `npm run smoke` sin prefijos de entorno: el orquestador ya fija el perfil AWS. Usa comandos simples, uno por llamada: sin `&&` ni `cd`. Si la tarea necesita desplegar, no lo intentes: déjala in_progress, anota en tu entrada de spec/LOG.md una línea `- Pendiente deploy:` con qué desplegar y qué correr después, y confirma.'
impl_cmd() { # $1 = ID
  # shellcheck disable=SC2059
  local cmd=(claude -p "$(printf "$IMPL_PROMPT" "$1")"
    --permission-mode dontAsk --output-format stream-json --verbose
    --allowedTools "${IMPL_ALLOWED[@]}" --disallowedTools "${IMPL_DENIED[@]}")
  [ -n "${AUTOPILOT_IMPL_MODEL:-}" ] && cmd+=(--model "$AUTOPILOT_IMPL_MODEL")
  [ -n "${AUTOPILOT_MAX_USD:-}" ] && cmd+=(--max-budget-usd "$AUTOPILOT_MAX_USD")
  printf '%q ' "${cmd[@]}"
}

case "$REVIEWER" in
  codex) command -v codex >/dev/null || die "AUTOPILOT_REVIEWER=codex pero codex no está en PATH"; REVIEWER_KIND=codex ;;
  claude) REVIEWER_KIND=claude ;;
  auto) if command -v codex >/dev/null; then REVIEWER_KIND=codex; else REVIEWER_KIND=claude; fi ;;
  *) die "AUTOPILOT_REVIEWER inválido: $REVIEWER (auto|codex|claude)" ;;
esac

review_cmd() { # imprime la orden del revisor; lee el prompt por stdin
  local cmd
  if [ "$REVIEWER_KIND" = codex ]; then
    cmd=(codex exec --sandbox read-only -C "$ROOT" --ephemeral --color never -o "$RUN_DIR/REVIEW-last.txt" -)
    [ -n "${AUTOPILOT_REVIEW_MODEL:-}" ] && cmd+=(--model "$AUTOPILOT_REVIEW_MODEL")
  else
    cmd=(claude -p --permission-mode dontAsk --output-format text
      --allowedTools "${REVIEW_ALLOWED[@]}" --disallowedTools "${REVIEW_DENIED[@]}")
    [ -n "${AUTOPILOT_REVIEW_MODEL:-}" ] && cmd+=(--model "$AUTOPILOT_REVIEW_MODEL")
    [ -n "${AUTOPILOT_MAX_USD:-}" ] && cmd+=(--max-budget-usd "$AUTOPILOT_MAX_USD")
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
Co-Authored-By: autopilot <noreply@local>"
  git_head
}

write_summary() {
  local elapsed=$((($(date +%s) - START) / 60))
  local hecho verificado
  hecho=$(printf '%s; ' "${SUMMARY[@]:-nada}"); hecho=${hecho%; }
  verificado=$(printf '%s; ' "${VERIFIED[@]:-sin comandos ejecutados}"); verificado=${verificado%; }
  local deploy
  deploy=$(printf '%s, ' "${DEPLOY_PENDING[@]:-ninguna}"); deploy=${deploy%, }
  local manual
  manual=$(tasks manual-pending | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(l.length?l.join("; "):"ninguna")')
  local tokens
  tokens=$(tokens_summary | paste -sd ';' | sed 's/;/; /g')
  log "tokens (implementador): $tokens"
  local body
  body=$(cat <<EOF
- Hecho: ${hecho}. Corrida ${RUN_ID} (${elapsed} min, ${TASKS_DONE} tarea(s) completada(s), ${FAILURES} fallo(s)); registros en .autopilot/${RUN_ID}/.
- Tokens (implementador, campo usage del evento result): ${tokens}.
- Pendiente manual (el usuario la hace al aceptar en lote, DEC-011): ${manual}.
- Pendiente deploy (el usuario corre \`npm run deploy:dev\`; el orquestador no despliega): ${deploy}.
- Verificado y cómo: ${verificado}.
- En curso / roto: $(git status --porcelain | grep -q . && echo "árbol de trabajo sucio (ver git status)" || echo "árbol limpio en $(git_head)").
- Bloqueos nuevos: $(node -e 'const d=require(process.argv[1]);const b=d.tasks.filter(t=>t.status==="blocked").map(t=>`${t.id} (${t.blocked_by})`);console.log(b.length?b.join(", "):"ninguno")' "$ROOT/spec/TASKS.json").
- Motivo de parada: ${STOP_REASON}.
- Próxima acción autorizada: el usuario revisa este resumen, los veredictos registrados en TASKS.json y los registros de la corrida; decide accepted o devuelve la tarea. El orquestador no marca accepted ni hace push.
EOF
)
  if [ "$DRY_RUN" = 1 ]; then
    echo; echo "== Entrada que se anotaría en spec/LOG.md (no escrita: --dry-run) =="
    printf '## %s · autopilot (scripts/autopilot.sh)\n%s\n' "$(now_stamp)" "$body"
    return
  fi
  local dirty=0
  git status --porcelain | grep -q . && dirty=1
  printf '%s\n' "$body" | append_log "autopilot (scripts/autopilot.sh)"
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
    const v=JSON.parse(fs.readFileSync(f,"utf8"));v.reviewer=label+" (contexto limpio, autopilot)";
    fs.writeFileSync(f,JSON.stringify(v,null,2));' "$verdict_file" "$label"
  local verdict new_status findings
  verdict=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).verdict)' "$verdict_file")
  findings=$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(v.findings.length?v.findings.join(" | "):"sin hallazgos bloqueantes")' "$verdict_file")
  new_status=$(tasks set-review "$id" "$verdict_file")
  log "veredicto sobre $id: $verdict → estado $new_status"
  local reqs
  reqs=$(node -e 'const t=require(process.argv[1]).tasks.find(t=>t.id===process.argv[2]);console.log(t.reqs.length?t.reqs.join(", "):(t.kind==="tooling"?"N/A":"none"))' "$ROOT/spec/TASKS.json" "$id")
  append_log "revisor independiente ($label) vía autopilot" <<EOF
- Hecho: revisión independiente de $id con contexto limpio (solo diff + REQ/DEC de la tarea). Veredicto: **$verdict** → estado \`$new_status\`. Hallazgos: $findings.
- Verificado y cómo: veredicto completo en TASKS.json (\`review\` de $id); salida íntegra en .autopilot/$RUN_ID/$id-review-output.txt.
- Próxima acción autorizada: continúa el orquestador nocturno; el usuario decide accepted por la mañana.
EOF
  local sha
  sha=$(commit_spec "$id: revisión independiente ($verdict)" "$id" "$reqs") || { STOP_REASON="no se pudo confirmar el veredicto de $id"; ABNORMAL=1; return 1; }
  SUMMARY+=("$id revisada por $kind: $verdict → $new_status (commit $sha)")
  if [ "$verdict" = rejected ]; then REJECTED+=("$id"); fi
  return 0
}

# ---------- Implementación ----------
run_task() { # $1 = ID, $2 = intento; devuelve 0 si la tarea avanzó, 1 si falló, 2 si hay que detenerse,
             # 3 si quedó sin cambios, 4 si espera un despliegue
  local id=$1 attempt=$2 head_before rc=0 status before status_before
  before=$RUN_DIR/$id-before-$attempt.json
  tasks snapshot >"$before"
  head_before=$(git_head)
  status_before=$(tasks status "$id")
  log "implementador sobre $id (intento $attempt, $(remaining) s restantes)"
  # Flujo stream-json → líneas legibles en la terminal y live.log; copia íntegra en .jsonl, evento final en .json.
  set +e
  # shellcheck disable=SC2046
  eval timeout -k 30 "$(remaining)" "$(impl_cmd "$id")" 2>"$RUN_DIR/$id-impl-$attempt.err" \
    | node "$ROOT/scripts/lib/autopilot-stream.mjs" --label "$id" \
        --raw "$RUN_DIR/$id-impl-$attempt.jsonl" --result "$RUN_DIR/$id-impl-$attempt.json" --tokens "$TOKENS" \
    | tee -a "$LIVE"
  rc=${PIPESTATUS[0]}
  set -e
  log "  $(node --input-type=module -e '
    import fs from "fs";const {usageOf,formatUsage}=await import(process.argv[3]);
    try{const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    fs.writeFileSync(process.argv[2],(r.result??"")+"\n");const u=usageOf(r);
    console.log(`turnos=${r.num_turns} tokens: ${u?formatUsage(u):"sin usage"} error=${r.is_error}`)}catch{console.log("(salida no JSON)")}' \
    "$RUN_DIR/$id-impl-$attempt.json" "$RUN_DIR/$id-impl-$attempt.txt" "$ROOT/scripts/lib/autopilot-stream.mjs" </dev/null)"
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
  if [ "$status" = in_progress ] && deploy_pending_since "$head_before"; then
    SUMMARY+=("$id: el implementador la dejó in_progress con Pendiente deploy; se salta en esta corrida")
    return 4
  fi
  if [ "$status" = in_progress ] && [ "$(tasks kind "$id")" = spec ] && [ "$(git_head)" != "$head_before" ]; then
    SUMMARY+=("$id: tarea de spec in_progress; espera que el usuario apruebe el diff de tests/acceptance/; se salta en esta corrida")
    return 5
  fi
  if [ "$rc" -eq 0 ] && [ "$(git_head)" = "$head_before" ] && [ "$status" = "$status_before" ]; then
    SUMMARY+=("$id: el implementador la dejó sin cambios (estado $status); se salta en esta corrida")
    return 3
  fi
  case "$status" in
    blocked)
      STOP_REASON="$id quedó blocked ($(node -e 'console.log(require(process.argv[1]).tasks.find(t=>t.id===process.argv[2]).blocked_by)' "$ROOT/spec/TASKS.json" "$id"))"
      SUMMARY+=("$id bloqueada por el implementador"); ABNORMAL=1
      return 2 ;;
    verified_auto|done)
      if ! npm run -s check:spec >"$RUN_DIR/$id-check-spec.txt" 2>&1; then
        SUMMARY+=("$id quedó $status pero check:spec falla")
        VERIFIED+=("npm run check:spec tras $id → falla (ver .autopilot/$RUN_ID/$id-check-spec.txt)")
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
  echo "autopilot: aviso: árbol de trabajo sucio (una corrida real se detendría aquí)" >&2
fi
mkdir -p "$ROOT/.autopilot" && printf '*\n' >"$ROOT/.autopilot/.gitignore"   # registros fuera de git
exec 9>"$ROOT/.autopilot/lock"
flock -n 9 || die "otra corrida nocturna está en marcha (.autopilot/lock)"
mkdir -p "$RUN_DIR"

[ -n "$AWS_KEY_ID" ] || echo "autopilot: aviso: sin perfil [$AUTOPILOT_AWS_PROFILE] en $AWS_SOURCE; aceptación y humo fallarán por credenciales" >&2
log "inicio en $(git_head) (rama $(git rev-parse --abbrev-ref HEAD)); presupuesto ${BUDGET}s, máx. ${MAX_TASKS} tareas, máx. ${MAX_FAILURES} fallos por tarea; revisor: $REVIEWER_KIND"
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

  if [ "$DRY_RUN" = 1 ]; then
    pending=$(tasks pending-reviews | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).join(" "))')
    echo "Revisiones pendientes antes de elegir tarea (verified_auto, revisor $REVIEWER_KIND): ${pending:-ninguna}"
    for id in $pending; do SUMMARY+=("(ensayo) $id se habría revisado"); done
  else
    review_pending || break
  fi

  if [ -n "$RETRY" ]; then pick=$(tasks pick --task "$RETRY"); RETRY=""
  elif [ -n "$FORCED_TASK" ]; then pick=$(tasks pick --task "$FORCED_TASK"); FORCED_TASK=""
  else pick=$(tasks pick --exclude "$SKIPPED"); fi
  if [ "$pick" = null ]; then STOP_REASON="no hay tareas in_progress/ready/approved_for_impl con dependencias cerradas${SKIPPED:+ (saltadas en esta corrida: ${SKIPPED%,})}"; break; fi
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

  if run_task "$ID" $((${FAILS[$ID]:-0} + 1)); then
    TASKS_DONE=$((TASKS_DONE + 1))
    REVIEWED_IDS="$REVIEWED_IDS$ID "
    review_task "$ID" || break
  else
    rc=$?
    [ "$rc" -eq 2 ] && break
    if [ "$rc" -eq 3 ] || [ "$rc" -eq 4 ] || [ "$rc" -eq 5 ]; then
      SKIPPED="$SKIPPED$ID,"
      if [ "$rc" -eq 4 ]; then DEPLOY_PENDING+=("$ID"); log "$ID espera un despliegue (Pendiente deploy): no cuenta como fallo; se pasa a la siguiente tarea independiente"
      elif [ "$rc" -eq 5 ]; then USER_WAIT+=("$ID"); log "$ID espera que el usuario apruebe el diff de tests/acceptance/ (tarea de spec): no cuenta como fallo; se pasa a la siguiente tarea independiente"
      else log "$ID quedó sin cambios: no cuenta como fallo; se pasa a la siguiente tarea independiente"; fi
      continue
    fi
    FAILS[$ID]=$((${FAILS[$ID]:-0} + 1)); FAILURES=$((FAILURES + 1))
    log "fallo ${FAILS[$ID]}/$MAX_FAILURES en $ID"
    if [ "${FAILS[$ID]}" -lt "$MAX_FAILURES" ]; then RETRY=$ID
    else
      SKIPPED="$SKIPPED$ID,"; ABNORMAL=1; ABANDONED+=("$ID")
      SUMMARY+=("$ID abandonada en esta corrida tras ${FAILS[$ID]} fallos (tope por tarea $MAX_FAILURES)")
      log "$ID llegó al tope de $MAX_FAILURES fallos: se abandona en esta corrida; se pasa a la siguiente tarea independiente"
    fi
  fi
done

log "parada: $STOP_REASON"
write_summary
notify_stop
[ "$DRY_RUN" = 1 ] && rmdir "$RUN_DIR" 2>/dev/null
exit "$ABNORMAL"   # 1 si la parada requiere intervención
