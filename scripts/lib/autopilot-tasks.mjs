#!/usr/bin/env node
// Operations on spec/ used by scripts/autopilot.sh (T-08). No dependencies.
//
//   node scripts/lib/autopilot-tasks.mjs [--root DIR] <command> [args]
//
//   pick [--task T-NN] [--exclude T-NN,…]
//                           first eligible task (in_progress/ready/approved_for_impl) with all its dependencies closed
//                           (done/reviewed/accepted/delivered) and not in --exclude, or the forced one → JSON | null
//   pending-reviews         ids of the tasks in verified_auto (awaiting independent review) → JSON
//   manual-pending          manual checks deferred to the batch acceptance (DEC-011) → JSON ["T-NN: …"]
//   snapshot                map id → status of every task → JSON
//   check-authority FILE    compares with snapshot FILE; fails if the executor granted a reserved status
//   status T-NN             prints the task's status
//   context T-NN            Markdown with the task, its REQs (SPEC.md) and its DECs (DECISIONS.md) for the reviewer
//   parse-verdict FILE      extracts the JSON verdict from the reviewer output → normalized JSON (exit 1 if none)
//   set-review T-NN FILE    stores the verdict (FILE, normalized JSON) in TASKS.json; approved → reviewed
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** States from which the orchestrator may take a task; `in_progress` to resume a half-done one. */
export const ELIGIBLE_STATES = ['in_progress', 'ready', 'approved_for_impl'];
/** States that close a dependency. `reviewed` included to chain tasks without waiting for the user's acceptance. */
export const DONE_STATES = ['done', 'reviewed', 'accepted', 'delivered'];
/** States only the reviewer or the user grant (AGENTS.md §Autoridad). The executor never writes them. */
export const RESERVED_STATES = ['reviewed', 'accepted', 'approved_for_impl', 'delivered'];
export const VERDICTS = ['approved', 'rejected'];

const tasksPath = (root) => join(root, 'spec/TASKS.json');

export function readTasks(root) {
  return JSON.parse(readFileSync(tasksPath(root), 'utf8'));
}

function writeTasks(root, data) {
  writeFileSync(tasksPath(root), JSON.stringify(data, null, 2) + '\n');
}

function findTask(data, id) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`${id} does not exist in spec/TASKS.json`);
  return t;
}

export function pick(data, forced, exclude = []) {
  if (forced) return findTask(data, forced);
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  return (
    data.tasks.find(
      (t) =>
        ELIGIBLE_STATES.includes(t.status) &&
        !exclude.includes(t.id) &&
        (t.depends_on ?? []).every((d) => DONE_STATES.includes(byId.get(d)?.status)),
    ) ?? null
  );
}

/** Tasks awaiting independent review: the orchestrator reviews them before picking a new task. */
export function pendingReviews(data) {
  return data.tasks.filter((t) => t.status === 'verified_auto').map((t) => t.id);
}

/** States in which a manual check is still pending: the user hasn't accepted the task yet. */
export const MANUAL_PENDING_STATES = ['verified_auto', 'reviewed'];

/** Deferred manual checks (DEC-011): `evidence.manual_pending` of the tasks not yet accepted. */
export function manualPending(data) {
  return data.tasks
    .filter((t) => MANUAL_PENDING_STATES.includes(t.status) && typeof t.evidence?.manual_pending === 'string' && t.evidence.manual_pending.trim())
    .map((t) => `${t.id}: ${t.evidence.manual_pending.trim().replace(/\.$/, '')}`);
}

export function snapshot(data) {
  return Object.fromEntries(data.tasks.map((t) => [t.id, t.status]));
}

/** Tasks whose status moved to a reserved one since the snapshot (or that appeared already in one). */
export function authorityViolations(before, data) {
  return data.tasks
    .filter((t) => RESERVED_STATES.includes(t.status) && before[t.id] !== t.status)
    .map((t) => `${t.id}: ${before[t.id] ?? '(new)'} → ${t.status}`);
}

/** Markdown section from the id's heading (level 2–4) to the next heading of the same or higher level. */
function section(text, id) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^#{2,4} ${id}\\b`).test(l));
  if (start < 0) return null;
  const level = /^(#+)/.exec(lines[start])[1].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6}) /.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

export function context(root, id) {
  const t = findTask(readTasks(root), id);
  const spec = existsSync(join(root, 'spec/SPEC.md')) ? readFileSync(join(root, 'spec/SPEC.md'), 'utf8') : '';
  const decs = existsSync(join(root, 'spec/DECISIONS.md')) ? readFileSync(join(root, 'spec/DECISIONS.md'), 'utf8') : '';
  const out = [];
  out.push(`# Task ${t.id}: ${t.title}`, '');
  if (t.kind) out.push(`- Kind: ${t.kind}`);
  if (t.description) out.push(`- Description: ${t.description}`);
  if (t.verify) out.push(`- Declared verification: ${t.verify}`);
  out.push(`- Cited requirements: ${(t.reqs ?? []).join(', ') || 'none (the description and the declared verification act as the requirement)'}`);
  out.push(`- Cited decisions: ${(t.decisions ?? []).join(', ') || 'none'}`);
  out.push('', '# Requirements (spec/SPEC.md)', '');
  for (const r of t.reqs ?? []) out.push(section(spec, r) ?? `(${r} not found in spec/SPEC.md)`, '');
  if ((t.reqs ?? []).length === 0) out.push('(no product REQ)', '');
  out.push('# Cited accepted decisions (spec/DECISIONS.md)', '');
  for (const d of t.decisions ?? []) out.push(section(decs, d) ?? `(${d} not found in spec/DECISIONS.md)`, '');
  if ((t.decisions ?? []).length === 0) out.push('(none)', '');
  return out.join('\n');
}

/** The reviewer's verdict: the last ```json … ``` block; failing that, the last `{"verdict"…}` in the text; failing that, the whole text. */
export function parseVerdict(text) {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = [];
  if (fenced.length > 0) candidates.push(fenced[fenced.length - 1]);
  const raw = text.lastIndexOf('{"verdict"');
  if (raw >= 0) candidates.push(text.slice(raw));
  candidates.push(text.trim());
  for (const c of candidates) {
    const obj = tryParseObject(c);
    if (!obj || typeof obj.verdict !== 'string') continue;
    const verdict = obj.verdict.trim().toLowerCase();
    if (!VERDICTS.includes(verdict)) return null;
    const findings = Array.isArray(obj.findings) ? obj.findings.map(String) : [];
    return { verdict, findings, notes: typeof obj.notes === 'string' ? obj.notes : '' };
  }
  return null;
}

/** Lenient JSON.parse: cuts at the brace that closes the first object. */
function tryParseObject(s) {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(s.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function setReview(root, id, review) {
  if (!VERDICTS.includes(review.verdict)) throw new Error(`invalid verdict: ${review.verdict}`);
  const data = readTasks(root);
  const t = findTask(data, id);
  t.review = {
    reviewer: review.reviewer ?? 'desconocido', // value stored in spec/, which stays in Spanish (DEC-018)
    verdict: review.verdict,
    findings: review.findings ?? [],
    notes: review.notes ?? '',
    date: review.date ?? new Date().toISOString().slice(0, 10),
  };
  // verified_auto → reviewed only with approval (sdd.md §8.2). Rejection: keeps the status and records the verdict.
  if (review.verdict === 'approved' && t.status === 'verified_auto') t.status = 'reviewed';
  writeTasks(root, data);
  return t.status;
}

function main(argv) {
  let root = fileURLToPath(new URL('../..', import.meta.url));
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else rest.push(argv[i]);
  }
  const [cmd, ...args] = rest;
  const out = (v) => process.stdout.write((typeof v === 'string' ? v : JSON.stringify(v, null, 2)) + '\n');

  switch (cmd) {
    case 'pick': {
      const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
      const exclude = (opt('--exclude') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
      const t = pick(readTasks(root), opt('--task'), exclude);
      out(t ? { id: t.id, title: t.title, kind: t.kind ?? 'impl', status: t.status, reqs: t.reqs ?? [], decisions: t.decisions ?? [] } : null);
      return 0;
    }
    case 'pending-reviews':
      out(pendingReviews(readTasks(root)));
      return 0;
    case 'manual-pending':
      out(manualPending(readTasks(root)));
      return 0;
    case 'snapshot':
      out(snapshot(readTasks(root)));
      return 0;
    case 'check-authority': {
      const before = JSON.parse(readFileSync(args[0], 'utf8'));
      const v = authorityViolations(before, readTasks(root));
      if (v.length > 0) {
        console.error(`autopilot: the executor granted reserved statuses (${RESERVED_STATES.join(', ')}):`);
        for (const line of v) console.error(`  ✗ ${line}`);
        return 1;
      }
      return 0;
    }
    case 'status':
      out(findTask(readTasks(root), args[0]).status);
      return 0;
    case 'kind':
      out(findTask(readTasks(root), args[0]).kind ?? 'impl');
      return 0;
    case 'context':
      out(context(root, args[0]));
      return 0;
    case 'parse-verdict': {
      const v = parseVerdict(readFileSync(args[0], 'utf8'));
      if (!v) {
        console.error('autopilot: the reviewer output contains no valid JSON verdict');
        return 1;
      }
      out(v);
      return 0;
    }
    case 'set-review': {
      const review = JSON.parse(readFileSync(args[1], 'utf8'));
      out(setReview(root, args[0], review));
      return 0;
    }
    default:
      console.error(`unknown command: ${cmd ?? '(none)'}`);
      return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`autopilot-tasks: ${e.message}`);
    process.exit(1);
  }
}
