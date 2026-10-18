#!/usr/bin/env node
// Operaciones sobre spec/ que usa scripts/night-loop.sh (T-08). Sin dependencias.
//
//   node scripts/lib/night-tasks.mjs [--root DIR] <orden> [args]
//
//   pick [--task T-NN]      primera tarea elegible (ready/approved_for_impl) con todas sus dependencias cerradas (o la forzada) → JSON | null
//   snapshot                mapa id → status de todas las tareas → JSON
//   check-authority FILE    compara con el snapshot FILE; falla si el ejecutor otorgó un estado reservado
//   status T-NN             imprime el estado de la tarea
//   context T-NN            Markdown con la tarea, sus REQ (SPEC.md) y sus DEC (DECISIONS.md) para el revisor
//   parse-verdict FILE      extrae el veredicto JSON de la salida del revisor → JSON normalizado (exit 1 si no hay)
//   set-review T-NN FILE    guarda el veredicto (FILE, JSON normalizado) en TASKS.json; approved → reviewed
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Estados desde los que el orquestador puede tomar una tarea. */
export const ELIGIBLE_STATES = ['ready', 'approved_for_impl'];
/** Estados que cierran una dependencia. */
export const DONE_STATES = ['done', 'accepted', 'delivered'];
/** Estados que solo otorgan el revisor o el usuario (AGENTS.md §Autoridad). El ejecutor nunca los escribe. */
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
  if (!t) throw new Error(`${id} no existe en spec/TASKS.json`);
  return t;
}

export function pick(data, forced) {
  if (forced) return findTask(data, forced);
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  return (
    data.tasks.find(
      (t) =>
        ELIGIBLE_STATES.includes(t.status) &&
        (t.depends_on ?? []).every((d) => DONE_STATES.includes(byId.get(d)?.status)),
    ) ?? null
  );
}

export function snapshot(data) {
  return Object.fromEntries(data.tasks.map((t) => [t.id, t.status]));
}

/** Tareas cuyo estado pasó a uno reservado desde el snapshot (o que aparecieron ya en uno reservado). */
export function authorityViolations(before, data) {
  return data.tasks
    .filter((t) => RESERVED_STATES.includes(t.status) && before[t.id] !== t.status)
    .map((t) => `${t.id}: ${before[t.id] ?? '(nueva)'} → ${t.status}`);
}

/** Sección Markdown que empieza en el encabezado del id (nivel 2–4) hasta el siguiente encabezado del mismo nivel o superior. */
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
  out.push(`# Tarea ${t.id}: ${t.title}`, '');
  if (t.kind) out.push(`- Clase: ${t.kind}`);
  if (t.description) out.push(`- Descripción: ${t.description}`);
  if (t.verify) out.push(`- Verificación declarada: ${t.verify}`);
  out.push(`- Requisitos citados: ${(t.reqs ?? []).join(', ') || 'ninguno (la descripción y la verificación declarada hacen de requisito)'}`);
  out.push(`- Decisiones citadas: ${(t.decisions ?? []).join(', ') || 'ninguna'}`);
  out.push('', '# Requisitos (spec/SPEC.md)', '');
  for (const r of t.reqs ?? []) out.push(section(spec, r) ?? `(${r} no encontrado en spec/SPEC.md)`, '');
  if ((t.reqs ?? []).length === 0) out.push('(sin REQ de producto)', '');
  out.push('# Decisiones aceptadas citadas (spec/DECISIONS.md)', '');
  for (const d of t.decisions ?? []) out.push(section(decs, d) ?? `(${d} no encontrada en spec/DECISIONS.md)`, '');
  if ((t.decisions ?? []).length === 0) out.push('(ninguna)', '');
  return out.join('\n');
}

/** Veredicto del revisor: el último bloque ```json … ```; si no hay, el último `{"verdict"…}` del texto; si no, el texto entero. */
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

/** JSON.parse tolerante: recorta hasta la llave que cierra el primer objeto. */
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
  if (!VERDICTS.includes(review.verdict)) throw new Error(`veredicto inválido: ${review.verdict}`);
  const data = readTasks(root);
  const t = findTask(data, id);
  t.review = {
    reviewer: review.reviewer ?? 'desconocido',
    verdict: review.verdict,
    findings: review.findings ?? [],
    notes: review.notes ?? '',
    date: review.date ?? new Date().toISOString().slice(0, 10),
  };
  // verified_auto → reviewed solo con aprobación (sdd.md §8.2). Rechazo: conserva el estado y queda el veredicto.
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
      const forced = args[0] === '--task' ? args[1] : undefined;
      const t = pick(readTasks(root), forced);
      out(t ? { id: t.id, title: t.title, kind: t.kind ?? 'impl', status: t.status, reqs: t.reqs ?? [], decisions: t.decisions ?? [] } : null);
      return 0;
    }
    case 'snapshot':
      out(snapshot(readTasks(root)));
      return 0;
    case 'check-authority': {
      const before = JSON.parse(readFileSync(args[0], 'utf8'));
      const v = authorityViolations(before, readTasks(root));
      if (v.length > 0) {
        console.error(`night-loop: el ejecutor otorgó estados reservados (${RESERVED_STATES.join(', ')}):`);
        for (const line of v) console.error(`  ✗ ${line}`);
        return 1;
      }
      return 0;
    }
    case 'status':
      out(findTask(readTasks(root), args[0]).status);
      return 0;
    case 'context':
      out(context(root, args[0]));
      return 0;
    case 'parse-verdict': {
      const v = parseVerdict(readFileSync(args[0], 'utf8'));
      if (!v) {
        console.error('night-loop: la salida del revisor no contiene un veredicto JSON válido');
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
      console.error(`orden desconocida: ${cmd ?? '(ninguna)'}`);
      return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`night-tasks: ${e.message}`);
    process.exit(1);
  }
}
