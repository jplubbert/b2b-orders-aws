#!/usr/bin/env bash
# Autopilot (T-08). Runs tasks of the PCR protocol unattended, within a budget.
#
#   scripts/autopilot.sh [--dry-run] [--task T-NN] [--max-tasks N] [--budget-seconds N] [--max-failures N]
#
# Cycle:
#   0. Before picking a new task, reviews every task in verified_auto (e.g. implemented in an interactive session)
#      with the same reviewer and mechanism as step 3; each one is reviewed only once per run (a rejection leaves it
#      in verified_auto and is not repeated until the next run).
#   1. Picks the first "in_progress" (resumes it), "ready" or "approved_for_impl" task of spec/TASKS.json with all its
#      dependencies closed (done/accepted/delivered, or reviewed: that way it chains tasks without waiting for the
#      user's acceptance). If there is none, writes to spec/LOG.md and ends.
#   2. Launches the implementer: `claude -p "Read AGENTS.md and execute <ID>. Stop according to the authority rules. …"`
#      (the prompt also asks for `npm run test:acceptance` without environment prefixes, simple commands without && or
#      cd, and "Pendiente deploy" instead of deploying; see IMPL_PROMPT)
#      with permissions scoped to the repository (no network, no push, no installs outside npm; AWS only with the
#      `autopilot` profile for `npm run test:acceptance` and `npm run smoke`). Live progress (stream-json → readable
#      lines) in the terminal and in .autopilot/<run>/live.log (`tail -f` from another terminal). Tokens of each
#      invocation (input, output, cache read and write, from the `usage` field of the `result` event) per task and
#      run total in the terminal, live.log and the LOG.md summary; the reviewer isn't counted (codex/claude in text
#      mode don't report them).
#   3. If the task ends verified_auto (or done), launches a reviewer with clean context (`codex exec`, or `claude -p`
#      if there is no codex) with the prompt of sdd.md §7.5, only over the task's diff and its REQ/DEC. The verdict
#      goes to TASKS.json (`review`; approved → reviewed) and to LOG.md.
#      If the implementer finishes fine (code 0) without changes (same HEAD and same status), or leaves the task
#      in_progress with a new "- Pendiente deploy:" line in LOG.md (one that doesn't say "ninguno", "nada", "N/A"…),
#      it is not a failure and is not retried: the task is skipped in this run and the next independent one is
#      picked. Same if a spec task stays in_progress with new commits: it waits for the user to approve the
#      tests/acceptance/ diff.
#      If the only thing pending is a manual check on the phone, the implementer leaves the task verified_auto
#      with `evidence.manual_pending` (DEC-011); the LOG.md summary lists those checks under "Pendiente manual".
#      Failures are counted per task: after the first one the same task is retried; with two
#      (AUTOPILOT_MAX_FAILURES) it is abandoned in this run and the next independent one follows (the run ends with
#      code 1).
#   4. Stops if the task ends blocked, if the budget (6 h) runs out, if it completes 10 tasks or if no eligible tasks
#      remain.
#      Always leaves a summary in LOG.md (and commits it with Task: T-08 / Req: N/A, unless the tree is left dirty).
#      Exit code 1 if the stop needs intervention (blocked, failures, authority violation, no verdict).
#   5. Never pushes, never deploys to AWS and never marks accepted/reviewed on its own (reviewed only with a verdict).
#   6. When stopping (also if it crashes), if there is an NTFY_TOPIC it sends a notice to $NTFY_URL/$NTFY_TOPIC
#      (T-21): stop reason, done/failed tasks and next action. High priority and alert tag if it needs intervention
#      (block, failure, reviewer rejection, budget limit, pending deploy or approval); normal if it finished fine.
#      If ntfy fails it is only logged: the run keeps its result. In --dry-run it shows the notice without sending it.
#   spec/LOG.md entries and the values written to spec/TASKS.json stay in Spanish; terminal output, logs, ntfy
#   notices and commits are in English (DEC-018).
#
# Mechanical guards on the child processes: only the `autopilot` AWS profile (IAM user autopilot-tests,
# DEC-010/DEC-015: table data and user pool admin of PedidosB2B-dev) copied to temporary
# AWS_CONFIG_FILE/AWS_SHARED_CREDENTIALS_FILE, so `default` doesn't exist for them (deploy/bootstrap/cdk also fail for
# lack of permissions); pushurl of every remote pointed at a nonexistent path, network and deploy tools denied to the
# implementer, and a check after each task that the executor didn't grant reserved statuses (reviewed/accepted/…).
#
# Variables: AUTOPILOT_MAX_TASKS (10), AUTOPILOT_BUDGET_SECONDS (21600), AUTOPILOT_MAX_FAILURES (2, per task), AUTOPILOT_REVIEWER (auto|codex|claude),
#            AUTOPILOT_IMPL_MODEL, AUTOPILOT_REVIEW_MODEL, AUTOPILOT_MAX_USD (cap per claude invocation, optional),
#            AUTOPILOT_AWS_PROFILE (autopilot), AUTOPILOT_AWS_CREDENTIALS (source of the keys; ~/.aws/credentials),
#            NTFY_TOPIC (empty: no notice), NTFY_URL (https://ntfy.sh), AUTOPILOT_NTFY_MAX (3000, notice length; minimum 1000).
# Local configuration: AUTOPILOT_CONFIG (default ~/.config/autopilot/autopilot.config.sh, outside the repo because the
# ntfy topic is a secret: whoever knows it reads the notices). It's a bash script that may set any of the variables
# above, e.g. `NTFY_TOPIC=autopilot-xxxxxxxx`. The variables are not passed to the child processes.
# Logs of each run: .autopilot/<date>/ (outside git).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

# ---------- Local configuration (outside git) ----------
AUTOPILOT_CONFIG=${AUTOPILOT_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/autopilot/autopilot.config.sh}
NTFY_TOPIC=${NTFY_TOPIC:-}
# shellcheck disable=SC1090
if [ -r "$AUTOPILOT_CONFIG" ]; then . "$AUTOPILOT_CONFIG"; fi
NTFY_URL=${NTFY_URL:-https://ntfy.sh}
export -n NTFY_TOPIC NTFY_URL 2>/dev/null || true   # the topic never reaches the implementer or the reviewer

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
    *) echo "autopilot: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

tasks() { node "$ROOT/scripts/lib/autopilot-tasks.mjs" --root "$ROOT" "$@"; }
RUN_ID=$(date '+%Y-%m-%d_%H%M%S')
RUN_DIR="$ROOT/.autopilot/$RUN_ID"
LIVE="$RUN_DIR/live.log"
TOKENS="$RUN_DIR/tokens.jsonl"   # one line per implementer invocation (autopilot-stream.mjs --tokens)
START=$(date +%s)
DEADLINE=$((START + BUDGET))
SUMMARY=()        # "Hecho" lines of the LOG.md summary (Spanish)
SUMMARY_EN=()     # the same lines in English, for the ntfy notice
VERIFIED=()       # "Verificado y cómo" lines (LOG.md only, Spanish)
STOP_REASON=""    # Spanish, for LOG.md
STOP_REASON_EN="" # English, for the terminal, live.log and ntfy
ABNORMAL=0       # 1 = stop that needs intervention (blocked, failures, violation, dirty tree, no verdict)
TASKS_DONE=0
FAILURES=0        # run total (for the summary); the cap applies per task (FAILS)
declare -A FAILS=()
DEPLOY_PENDING=() # tasks waiting for a deploy by the user
REVIEWED_IDS=" "  # tasks already reviewed in this run (never reviewed twice)
SKIPPED=""        # tasks the implementer left unchanged (comma-separated; not picked again)
ABANDONED=()      # tasks abandoned because of the failure cap
USER_WAIT=()      # spec tasks waiting for the user's approval
REJECTED=()       # tasks the reviewer rejected in this run
NOTIFIED=0        # 1 = the ntfy notice of the stop was already attempted

summary() { SUMMARY+=("$1"); SUMMARY_EN+=("$2"); }   # $1 = Spanish (LOG.md), $2 = English (ntfy)
stop_reason() { STOP_REASON=$1; STOP_REASON_EN=$2; }  # $1 = Spanish (LOG.md), $2 = English (terminal, ntfy)
log() { # to the terminal and, in a real run, to live.log
  local line; line=$(printf '%s autopilot: %s' "$(date '+%H:%M:%S')" "$*")
  printf '%s\n' "$line"
  if [ "$DRY_RUN" = 0 ] && [ -d "$RUN_DIR" ]; then printf '%s\n' "$line" >>"$LIVE"; fi
  return 0
}
die() { echo "autopilot: $*" >&2; exit 1; }
tokens_summary() { node "$ROOT/scripts/lib/autopilot-stream.mjs" tokens-summary "$TOKENS" "$@"; }
remaining() { echo $((DEADLINE - $(date +%s))); }
now_stamp() { date '+%Y-%m-%d %H:%M'; }
git_head() { git rev-parse --short HEAD; }
# Is there a new "- Pendiente deploy:" line in LOG.md since $1 that asks for something? "ninguno", "nada", "N/A"… don't count.
# LOG.md stays in Spanish (DEC-018), so the patterns do too.
deploy_pending_since() {
  git diff "$1" HEAD -- spec/LOG.md | grep -E '^\+- Pendiente deploy:' \
    | grep -qviE '^\+- Pendiente deploy:[[:space:]]*(ningun[oa]?|nada|no aplica|n/?a|—|-)([[:space:].,;:()]|$)'
}

# ---------- ntfy notice on stop (T-21) ----------
ntfy_send() { # $1 = priority (high|default), $2 = tags, $3 = title, $4 = message. Never fails.
  NOTIFIED=1
  [ -n "$NTFY_TOPIC" ] || return 0
  if [ "$DRY_RUN" = 1 ]; then
    printf '\n== ntfy notice that would be sent (not sent: --dry-run; priority %s, tags %s) ==\n%s\n%s\n' "$1" "$2" "$3" "$4"
    return 0
  fi
  local err=/dev/null rc=0
  [ -d "$RUN_DIR" ] && err="$RUN_DIR/ntfy.err"
  curl -fsS --max-time 15 -o /dev/null -H "Title: $3" -H "Priority: $1" -H "Tags: $2" \
    --data-binary "$4" "$NTFY_URL/$NTFY_TOPIC" 2>>"$err" || rc=$?
  if [ "$rc" = 0 ]; then log "ntfy notice sent (priority $1)"
  else log "warning: ntfy failed (code $rc); the run keeps its result"; fi
  return 0
}
short_list() { # task list bounded for the notice: the first 5 and "… (+N more)"
  local n=$#
  if [ "$n" -le 5 ]; then printf '%s' "$*"; else printf '%s … (+%s more)' "${*:1:5}" "$((n - 5))"; fi
}
ntfy_body() { # $1 = reason, $2 = next action. Fixed fields complete and first; only the detail is trimmed (DEC-016).
  # The fixed fields are bounded at the source (lists via short_list, reason and next action without long free text:
  # see STOP_REASON), so they always fit in the 1000-character minimum; ntfy accepts 4096 bytes per message.
  local max=${AUTOPILOT_NTFY_MAX:-3000}
  [ "$max" -ge 1000 ] 2>/dev/null || max=1000
  local failed="${FAILURES} failure(s)"
  [ "${#ABANDONED[@]}" -gt 0 ] && failed+="; abandoned: $(short_list "${ABANDONED[@]}")"
  [ "${#REJECTED[@]}" -gt 0 ] && failed+="; rejected by the reviewer: $(short_list "${REJECTED[@]}")"
  local fixed detail room
  fixed=$(printf 'Stop reason: %s\nDone: %s task(s) · Failed: %s\nNext action: %s\nRun %s (logs in .autopilot/%s/)' \
    "$1" "$TASKS_DONE" "$failed" "$2" "$RUN_ID" "$RUN_ID")
  detail=$(printf '%s; ' "${SUMMARY_EN[@]:-nothing}"); detail=${detail%; }
  room=$((max - ${#fixed} - 9))   # 9 = "\nDetail: "
  if [ "$room" -le 1 ]; then printf '%s' "$fixed"; return 0; fi
  [ "${#detail}" -gt "$room" ] && detail="${detail:0:$((room - 1))}…"
  printf '%s\nDetail: %s' "$fixed" "$detail"
}
notify_stop() { # notice of the normal stop (after write_summary)
  local repo intervention=0 next
  repo=$(basename "$ROOT")
  [ "$ABNORMAL" = 1 ] && intervention=1
  case "$STOP_REASON_EN" in "time budget"*|"task budget"*) intervention=1 ;; esac
  [ "${#DEPLOY_PENDING[@]}" -gt 0 ] && intervention=1
  [ "${#USER_WAIT[@]}" -gt 0 ] && intervention=1
  [ "${#REJECTED[@]}" -gt 0 ] && intervention=1
  if [ "$(node -e 'console.log(require(process.argv[1]).tasks.some(t=>t.status==="blocked"))' "$ROOT/spec/TASKS.json")" = true ]; then
    intervention=1; next="resolve the block (${STOP_REASON_EN}) and relaunch the autopilot"
  elif [ "${#ABANDONED[@]}" -gt 0 ]; then next="review the failures of $(short_list "${ABANDONED[@]}") in .autopilot/${RUN_ID}/ and relaunch"
  elif [ "${#REJECTED[@]}" -gt 0 ]; then next="address the reviewer's findings (review of $(short_list "${REJECTED[@]}") in spec/TASKS.json)"
  elif [ "$ABNORMAL" = 1 ]; then next="check by hand: ${STOP_REASON_EN}"
  elif [ "${#DEPLOY_PENDING[@]}" -gt 0 ]; then next="run npm run deploy:dev ($(short_list "${DEPLOY_PENDING[@]}")) and relaunch the autopilot"
  elif [ "${#USER_WAIT[@]}" -gt 0 ]; then next="approve the tests/acceptance/ diff of $(short_list "${USER_WAIT[@]}")"
  elif [ "$intervention" = 1 ]; then next="relaunch the autopilot to continue (limit reached)"
  else next="review the summary in spec/LOG.md and the verdicts in TASKS.json; decide accepted"; fi
  local msg; msg=$(ntfy_body "$STOP_REASON_EN" "$next")
  if [ "$intervention" = 1 ]; then ntfy_send high warning,rotating_light "autopilot $repo: needs your intervention" "$msg"
  else ntfy_send default white_check_mark "autopilot $repo: finished fine" "$msg"; fi
}
on_exit() { # $1 = exit code; if the run crashes before the normal notice, notify anyway
  rm -rf "${AWS_SANDBOX:-}"
  if [ "$NOTIFIED" = 0 ] && [ "$1" != 0 ]; then
    ntfy_send high warning,rotating_light "autopilot $(basename "$ROOT"): stopped unexpectedly" \
      "$(ntfy_body "the autopilot exited with code $1 before writing its summary${STOP_REASON_EN:+ ($STOP_REASON_EN)}" \
        "check the terminal, .autopilot/${RUN_ID}/ (live.log, ntfy.err) and git status; relaunch the autopilot")"
  fi
}

# ---------- Environment guards (inherited by claude/codex and everything they launch) ----------
export AUTOPILOT=1
export CI=1
# AWS: only the autopilot profile (DEC-010, DEC-015), copied to temporary files; default and the rest don't exist for the children.
AUTOPILOT_AWS_PROFILE=${AUTOPILOT_AWS_PROFILE:-autopilot}
AWS_SOURCE=${AUTOPILOT_AWS_CREDENTIALS:-${AWS_SHARED_CREDENTIALS_FILE:-$HOME/.aws/credentials}}
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE AWS_DEFAULT_REGION
AWS_SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/autopilot-aws.XXXXXX")
trap 'on_exit $?' EXIT
aws_profile_key() { # $1 = key; reads the [$AUTOPILOT_AWS_PROFILE] section of the source credentials file
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
  export "GIT_CONFIG_KEY_${n}=remote.${remote}.pushurl" "GIT_CONFIG_VALUE_${n}=/nonexistent/autopilot-no-push"
  n=$((n + 1))
done
[ "$n" -gt 0 ] && export GIT_CONFIG_COUNT=$n
unset n remote

# ---------- Implementer permissions (claude -p) ----------
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

# "- Pendiente deploy:" stays in Spanish: it's a spec/LOG.md line (DEC-018) that deploy_pending_since looks for.
IMPL_PROMPT='Read AGENTS.md and execute %s. Stop according to the authority rules. Run `npm run test:acceptance` and `npm run smoke` without environment prefixes: the orchestrator already sets the AWS profile. Use simple commands, one per call: no `&&` and no `cd`. If the task needs a deploy, do not attempt it: leave it in_progress, add to your spec/LOG.md entry a `- Pendiente deploy:` line saying what to deploy and what to run afterwards, and commit.'
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
  codex) command -v codex >/dev/null || die "AUTOPILOT_REVIEWER=codex but codex is not in PATH"; REVIEWER_KIND=codex ;;
  claude) REVIEWER_KIND=claude ;;
  auto) if command -v codex >/dev/null; then REVIEWER_KIND=codex; else REVIEWER_KIND=claude; fi ;;
  *) die "invalid AUTOPILOT_REVIEWER: $REVIEWER (auto|codex|claude)" ;;
esac

review_cmd() { # prints the reviewer command; it reads the prompt from stdin
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

# ---------- Reviewer prompt (sdd.md §7.5) ----------
review_prompt() { # $1 = ID; writes the full prompt to stdout
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
You are an independent reviewer with clean context. You did not take part in the implementation and must not trust
what the implementer claims: only what you see in the diff and what you can run counts.

You receive only: (a) task $id with the requirements (REQ) it cites, (b) the accepted decisions (DEC) it cites and
(c) the diff of the task's commits. Answer three questions:
  1. Is every requirement implemented and tested, edges included?
  2. Did anything change outside the task's scope?
  3. Was an accepted decision violated?

Rules:
- Explicitly exclude style and preferences. Do not propose refactors or improvements.
- Every finding must cite a REQ-NNN or a DEC-NNN. A finding without a citation does not block (you may mention it in "notes").
- Confirm every blocking finding by running something (a test, a command) before reporting it. If you could not
  run it, say so in the finding. The repository is at $ROOT in read-only mode: you may run
  \`npm test\`, \`npm run lint\`, \`npm run typecheck\`, \`npm run check:spec\` and \`git show <sha>\`.
- Do not modify any file. Do not commit.
- The verdict is "rejected" only if there is at least one blocking finding with a citation; otherwise "approved".
- Write "findings" and "notes" in Spanish: they are stored in spec/TASKS.json and spec/LOG.md, which stay in Spanish.

End your answer with exactly one JSON code block of this shape (no text after the block):
\`\`\`json
{"verdict": "approved" | "rejected", "findings": ["REQ-00X: …", "DEC-00X: …"], "notes": "observaciones no bloqueantes"}
\`\`\`

$(tasks context "$id")

# Task commits
$(for sha in $commits; do git show -s --format='%h %s' "$sha"; done)

# Diff
$(head -c 400000 "$diff_file")
$( [ "$(wc -c <"$diff_file")" -gt 400000 ] && echo "… (diff truncated to 400 KB; use git show <sha> to see the rest)" )
EOF
}

# ---------- Log (spec/LOG.md, in Spanish) ----------
append_log() { # $1 = agent heading, rest on stdin
  { printf '\n## %s · %s\n' "$(now_stamp)" "$1"; cat; } >>"$ROOT/spec/LOG.md"
}

commit_spec() { # $1 = subject, $2 = Task, $3 = Req
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
  tokens=$(tokens_summary --lang es | paste -sd ';' | sed 's/;/; /g')
  log "tokens (implementer): $(tokens_summary | paste -sd ';' | sed 's/;/; /g')"
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
    echo; echo "== Entry that would be added to spec/LOG.md (not written: --dry-run) =="
    printf '## %s · autopilot (scripts/autopilot.sh)\n%s\n' "$(now_stamp)" "$body"
    return
  fi
  local dirty=0
  git status --porcelain | grep -q . && dirty=1
  printf '%s\n' "$body" | append_log "autopilot (scripts/autopilot.sh)"
  if [ "$dirty" = 1 ]; then
    log "summary added to spec/LOG.md WITHOUT commit: the tree was already dirty and nothing is committed blindly (git status)"
    return
  fi
  local sha
  sha=$(commit_spec "Autopilot: summary of run $RUN_ID" "T-08" "N/A") || die "could not commit the summary in LOG.md; check git status"
  log "summary added to spec/LOG.md (commit $sha)"
}

# ---------- Independent review ----------
review_task() { # $1 = ID; returns 0 if there was a verdict
  local id=$1 kind out prompt_file verdict_file
  prompt_file=$RUN_DIR/$id-review-prompt.md verdict_file=$RUN_DIR/$id-verdict.json
  kind=$REVIEWER_KIND
  review_prompt "$id" >"$prompt_file"
  log "reviewer ($kind) on $id: $(wc -c <"$prompt_file") bytes of context"
  out=$RUN_DIR/$id-review-output.txt
  local rc=0 t
  t=$(remaining); [ "$t" -lt 600 ] && t=600   # a finished task is always reviewed (min. 10 min)
  # shellcheck disable=SC2046
  eval timeout -k 30 "$t" "$(review_cmd)" <"$prompt_file" >"$out" 2>"$RUN_DIR/$id-review.err" || rc=$?
  [ "$kind" = codex ] && [ -s "$RUN_DIR/REVIEW-last.txt" ] && cp "$RUN_DIR/REVIEW-last.txt" "$out"
  if [ "$rc" -ne 0 ] && [ ! -s "$out" ]; then
    stop_reason "el revisor ($kind) terminó con código $rc sin salida (ver $RUN_DIR/$id-review.err)" \
      "the reviewer ($kind) exited with code $rc without output (see $RUN_DIR/$id-review.err)"; ABNORMAL=1
    return 1
  fi
  if ! tasks parse-verdict "$out" >"$verdict_file"; then
    stop_reason "el revisor ($kind) no entregó un veredicto JSON válido (ver $out)" \
      "the reviewer ($kind) gave no valid JSON verdict (see $out)"; ABNORMAL=1
    return 1
  fi
  local label
  if [ "$kind" = codex ]; then label="codex exec $(codex --version 2>/dev/null | head -1)"; else label="claude -p $(claude --version 2>/dev/null | head -1)"; fi
  # The reviewer label is stored in spec/TASKS.json, so its wording stays in Spanish (DEC-018).
  node -e '
    const fs=require("fs");const [f,label]=process.argv.slice(1);
    const v=JSON.parse(fs.readFileSync(f,"utf8"));v.reviewer=label+" (contexto limpio, autopilot)";
    fs.writeFileSync(f,JSON.stringify(v,null,2));' "$verdict_file" "$label"
  local verdict new_status findings
  verdict=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).verdict)' "$verdict_file")
  findings=$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(v.findings.length?v.findings.join(" | "):"sin hallazgos bloqueantes")' "$verdict_file")
  new_status=$(tasks set-review "$id" "$verdict_file")
  log "verdict on $id: $verdict → status $new_status"
  local reqs
  reqs=$(node -e 'const t=require(process.argv[1]).tasks.find(t=>t.id===process.argv[2]);console.log(t.reqs.length?t.reqs.join(", "):(t.kind==="tooling"?"N/A":"none"))' "$ROOT/spec/TASKS.json" "$id")
  append_log "revisor independiente ($label) vía autopilot" <<EOF
- Hecho: revisión independiente de $id con contexto limpio (solo diff + REQ/DEC de la tarea). Veredicto: **$verdict** → estado \`$new_status\`. Hallazgos: $findings.
- Verificado y cómo: veredicto completo en TASKS.json (\`review\` de $id); salida íntegra en .autopilot/$RUN_ID/$id-review-output.txt.
- Próxima acción autorizada: continúa el orquestador nocturno; el usuario decide accepted por la mañana.
EOF
  local sha
  sha=$(commit_spec "$id: independent review ($verdict)" "$id" "$reqs") || {
    stop_reason "no se pudo confirmar el veredicto de $id" "could not commit the verdict on $id"; ABNORMAL=1; return 1; }
  summary "$id revisada por $kind: $verdict → $new_status (commit $sha)" "$id reviewed by $kind: $verdict → $new_status (commit $sha)"
  if [ "$verdict" = rejected ]; then REJECTED+=("$id"); fi
  return 0
}

# ---------- Implementation ----------
run_task() { # $1 = ID, $2 = attempt; returns 0 if the task moved forward, 1 if it failed, 2 if it must stop,
             # 3 if it ended unchanged, 4 if it waits for a deploy, 5 if it waits for the user's approval
  local id=$1 attempt=$2 head_before rc=0 status before status_before
  before=$RUN_DIR/$id-before-$attempt.json
  tasks snapshot >"$before"
  head_before=$(git_head)
  status_before=$(tasks status "$id")
  log "implementer on $id (attempt $attempt, $(remaining) s left)"
  # stream-json → readable lines in the terminal and live.log; full copy in .jsonl, final event in .json.
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
    console.log(`turns=${r.num_turns} tokens: ${u?formatUsage(u):"no usage"} error=${r.is_error}`)}catch{console.log("(non-JSON output)")}' \
    "$RUN_DIR/$id-impl-$attempt.json" "$RUN_DIR/$id-impl-$attempt.txt" "$ROOT/scripts/lib/autopilot-stream.mjs" </dev/null)"
  log "tokens for $id in the run: $(tokens_summary | grep "^$id: " | sed "s/^$id: //" || echo "no usage")"
  status=$(tasks status "$id" 2>/dev/null || echo "?")
  log "implementer finished (code $rc); $id → $status; HEAD $head_before → $(git_head)"

  if git status --porcelain | grep -q .; then
    stop_reason "árbol de trabajo sucio tras el implementador en $id (nada se descarta; revisar a mano)" \
      "dirty working tree after the implementer on $id (nothing is discarded; check by hand)"; ABNORMAL=1
    return 2
  fi
  if ! tasks check-authority "$before"; then
    stop_reason "el implementador otorgó un estado reservado en $id (violación de autoridad; revisar a mano)" \
      "the implementer granted a reserved status on $id (authority violation; check by hand)"; ABNORMAL=1
    return 2
  fi
  if [ "$status" = in_progress ] && deploy_pending_since "$head_before"; then
    summary "$id: el implementador la dejó in_progress con Pendiente deploy; se salta en esta corrida" \
      "$id: the implementer left it in_progress with Pendiente deploy; skipped in this run"
    return 4
  fi
  if [ "$status" = in_progress ] && [ "$(tasks kind "$id")" = spec ] && [ "$(git_head)" != "$head_before" ]; then
    summary "$id: tarea de spec in_progress; espera que el usuario apruebe el diff de tests/acceptance/; se salta en esta corrida" \
      "$id: spec task in_progress; waits for the user to approve the tests/acceptance/ diff; skipped in this run"
    return 5
  fi
  if [ "$rc" -eq 0 ] && [ "$(git_head)" = "$head_before" ] && [ "$status" = "$status_before" ]; then
    summary "$id: el implementador la dejó sin cambios (estado $status); se salta en esta corrida" \
      "$id: the implementer left it unchanged (status $status); skipped in this run"
    return 3
  fi
  case "$status" in
    blocked)
      # blocked_by should be an id (check:spec), but this path doesn't run check:spec and the hook can be skipped:
      # the reason carries an excerpt of at most 200 characters (full text in TASKS.json)
      local excerpt
      excerpt=$(node -e 'const b=String(require(process.argv[1]).tasks.find(t=>t.id===process.argv[2]).blocked_by);console.log(b.length>200?b.slice(0,199)+"…":b)' "$ROOT/spec/TASKS.json" "$id")
      stop_reason "$id quedó blocked ($excerpt)" "$id ended blocked ($excerpt)"
      summary "$id bloqueada por el implementador" "$id blocked by the implementer"; ABNORMAL=1
      return 2 ;;
    verified_auto|done)
      if ! npm run -s check:spec >"$RUN_DIR/$id-check-spec.txt" 2>&1; then
        summary "$id quedó $status pero check:spec falla" "$id ended $status but check:spec fails"
        VERIFIED+=("npm run check:spec tras $id → falla (ver .autopilot/$RUN_ID/$id-check-spec.txt)")
        return 1
      fi
      VERIFIED+=("npm run check:spec tras $id → ok")
      summary "$id implementada ($head_before..$(git_head), estado $status)" "$id implemented ($head_before..$(git_head), status $status)"
      return 0 ;;
    *)
      if [ "$rc" -eq 124 ]; then
        summary "$id: el implementador agotó el tiempo (estado $status)" "$id: the implementer ran out of time (status $status)"
      else
        summary "$id: el implementador terminó en $status (código $rc)" "$id: the implementer ended in $status (code $rc)"
      fi
      return 1 ;;
  esac
}

review_pending() { # reviews the verified_auto tasks not yet reviewed in this run; 1 = stop
  local id
  for id in $(tasks pending-reviews | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).join(" "))'); do
    case "$REVIEWED_IDS" in *" $id "*) continue ;; esac
    if [ "$(remaining)" -lt 600 ]; then
      stop_reason "presupuesto de tiempo agotado antes de revisar $id (quedan $(remaining)s)" \
        "time budget exhausted before reviewing $id ($(remaining)s left)"
      return 1
    fi
    REVIEWED_IDS="$REVIEWED_IDS$id "
    log "$id awaits independent review (verified_auto): reviewed before picking a new task"
    review_task "$id" || return 1
  done
  return 0
}

# ---------- Preconditions ----------
command -v claude >/dev/null || die "claude is not in PATH"
command -v timeout >/dev/null || die "coreutils timeout is missing"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repository"
if git status --porcelain | grep -q .; then
  [ "$DRY_RUN" = 1 ] || die "dirty working tree; commit or stash the changes before the nightly run"
  echo "autopilot: warning: dirty working tree (a real run would stop here)" >&2
fi
mkdir -p "$ROOT/.autopilot" && printf '*\n' >"$ROOT/.autopilot/.gitignore"   # logs outside git
exec 9>"$ROOT/.autopilot/lock"
flock -n 9 || die "another nightly run is in progress (.autopilot/lock)"
mkdir -p "$RUN_DIR"

[ -n "$AWS_KEY_ID" ] || echo "autopilot: warning: no [$AUTOPILOT_AWS_PROFILE] profile in $AWS_SOURCE; acceptance and smoke will fail for lack of credentials" >&2
log "start at $(git_head) (branch $(git rev-parse --abbrev-ref HEAD)); budget ${BUDGET}s, max ${MAX_TASKS} tasks, max ${MAX_FAILURES} failures per task; reviewer: $REVIEWER_KIND"
if [ "$DRY_RUN" = 1 ]; then
  echo
  echo "== Dry run (--dry-run): claude/codex are not launched, LOG.md is not written and no commits are made =="
  echo "Environment guards: AWS_PROFILE=$AWS_PROFILE ($( [ -n "$AWS_KEY_ID" ] && echo "key $AWS_KEY_ID" || echo "NO keys in $AWS_SOURCE"); the only profile in the temporary AWS_CONFIG_FILE/AWS_SHARED_CREDENTIALS_FILE) AWS_EC2_METADATA_DISABLED=$AWS_EC2_METADATA_DISABLED"
  echo "Remotes with push disabled: $(git remote | tr '\n' ' ')${GIT_CONFIG_COUNT:+(GIT_CONFIG_COUNT=$GIT_CONFIG_COUNT)}$( [ -z "$(git remote)" ] && echo '(none configured)')"
  echo
fi

# ---------- Cycle ----------
RETRY=""
while :; do
  if [ "$(remaining)" -lt 600 ]; then
    stop_reason "presupuesto de tiempo agotado (${BUDGET}s; quedan $(remaining)s, menos de 10 min)" \
      "time budget exhausted (${BUDGET}s; $(remaining)s left, under 10 min)"
    break
  fi
  if [ "$TASKS_DONE" -ge "$MAX_TASKS" ]; then stop_reason "presupuesto de tareas alcanzado ($MAX_TASKS)" "task budget reached ($MAX_TASKS)"; break; fi

  if [ "$DRY_RUN" = 1 ]; then
    pending=$(tasks pending-reviews | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).join(" "))')
    echo "Pending reviews before picking a task (verified_auto, reviewer $REVIEWER_KIND): ${pending:-none}"
    for id in $pending; do summary "(ensayo) $id se habría revisado" "(dry run) $id would have been reviewed"; done
  else
    review_pending || break
  fi

  if [ -n "$RETRY" ]; then pick=$(tasks pick --task "$RETRY"); RETRY=""
  elif [ -n "$FORCED_TASK" ]; then pick=$(tasks pick --task "$FORCED_TASK"); FORCED_TASK=""
  else pick=$(tasks pick --exclude "$SKIPPED"); fi
  if [ "$pick" = null ]; then
    stop_reason "no hay tareas in_progress/ready/approved_for_impl con dependencias cerradas${SKIPPED:+ (saltadas en esta corrida: $(IFS=,; short_list ${SKIPPED%,}))}" \
      "no in_progress/ready/approved_for_impl tasks with closed dependencies${SKIPPED:+ (skipped in this run: $(IFS=,; short_list ${SKIPPED%,}))}"
    break
  fi
  ID=$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$pick")
  TITLE=$(node -e 'console.log(JSON.parse(process.argv[1]).title)' "$pick")

  if [ "$DRY_RUN" = 1 ]; then
    echo "Chosen task: $ID — $TITLE"
    echo "  $(node -e 'const p=JSON.parse(process.argv[1]);console.log(`status ${p.status}, kind ${p.kind}, reqs [${p.reqs}], decisions [${p.decisions}]`)' "$pick")"
    echo "Implementer (from $ROOT, timeout $(remaining)s):"
    echo "  $(impl_cmd "$ID")"
    echo "After the implementer: requires a clean tree, check-authority (no reviewed/accepted/approved_for_impl/delivered granted), npm run check:spec."
    echo "Reviewer if it ends verified_auto/done ($REVIEWER_KIND), with prompt §7.5 + REQ/DEC + diff of the 'Task: $ID' commits on stdin:"
    echo "  $(review_cmd)"
    echo "  REQ/DEC context it would receive: $(tasks context "$ID" | wc -c) bytes; previous commits of the task: $(git log --format=%h -E --grep="^Task:[[:space:]]*$ID([[:space:],]|$)" | tr '\n' ' ')"
    summary "(ensayo) $ID se habría ejecutado" "(dry run) $ID would have been run"
    stop_reason "ensayo: se detiene tras planificar la primera tarea" "dry run: stops after planning the first task"
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
      if [ "$rc" -eq 4 ]; then DEPLOY_PENDING+=("$ID"); log "$ID waits for a deploy (Pendiente deploy): not counted as a failure; moving on to the next independent task"
      elif [ "$rc" -eq 5 ]; then USER_WAIT+=("$ID"); log "$ID waits for the user to approve the tests/acceptance/ diff (spec task): not counted as a failure; moving on to the next independent task"
      else log "$ID ended unchanged: not counted as a failure; moving on to the next independent task"; fi
      continue
    fi
    FAILS[$ID]=$((${FAILS[$ID]:-0} + 1)); FAILURES=$((FAILURES + 1))
    log "failure ${FAILS[$ID]}/$MAX_FAILURES on $ID"
    if [ "${FAILS[$ID]}" -lt "$MAX_FAILURES" ]; then RETRY=$ID
    else
      SKIPPED="$SKIPPED$ID,"; ABNORMAL=1; ABANDONED+=("$ID")
      summary "$ID abandonada en esta corrida tras ${FAILS[$ID]} fallos (tope por tarea $MAX_FAILURES)" \
        "$ID abandoned in this run after ${FAILS[$ID]} failures (per-task cap $MAX_FAILURES)"
      log "$ID reached the cap of $MAX_FAILURES failures: abandoned in this run; moving on to the next independent task"
    fi
  fi
done

log "stop: $STOP_REASON_EN"
write_summary
notify_stop
[ "$DRY_RUN" = 1 ] && rmdir "$RUN_DIR" 2>/dev/null
exit "$ABNORMAL"   # 1 if the stop needs intervention
