#!/usr/bin/env node
// Guardas mecánicas del protocolo PCR (T-02).
//
//   node scripts/check-spec.mjs                    valida spec/ y el historial de git (npm run check:spec)
//   node scripts/check-spec.mjs --commit-msg FILE  además valida el mensaje y el diff preparado (hook commit-msg)
//   --root DIR                                     raíz del repo a validar (por defecto, la de este script)
//
// Sale con código 1 y lista los errores si alguna regla falla.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Únicos archivos permitidos dentro de spec/ (rutas relativas a spec/). */
export const ALLOWED_SPEC_FILES = ['SPEC.md', 'DECISIONS.md', 'TASKS.json', 'LOG.md', 'contracts/schema.graphql'];

const TASK_STATUSES = [
  'proposed', 'analyzed', 'specified', 'approved_for_impl', 'ready', 'in_progress', 'implemented',
  'verified_auto', 'reviewed', 'accepted', 'delivered', 'done', 'blocked', 'superseded',
];
/** `spec`: única clase de tarea que puede editar tests/acceptance/. Sin `kind`, la tarea es de implementación. */
const TASK_KINDS = ['spec', 'impl'];
const PROTECTED_DIR = 'tests/acceptance/';

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

function parseArgs(argv) {
  const args = { root: fileURLToPath(new URL('..', import.meta.url)), commitMsg: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') args.root = argv[++i];
    else if (argv[i] === '--commit-msg') args.commitMsg = argv[++i];
    else throw new Error(`Argumento desconocido: ${argv[i]}`);
  }
  return args;
}

function readText(root, rel) {
  const path = join(root, rel);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** IDs declarados como encabezado o fila de tabla, p. ej. `### REQ-001 …`, `## DEC-004 …`, `| Q-01 | …`. */
function declaredIds(text, prefix) {
  const re = new RegExp(`^(?:#{2,4} |\\| )(${prefix}-\\d+)\\b`, 'gm');
  return new Set([...text.matchAll(re)].map((m) => m[1]));
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function isGitRepo(root) {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

/** Valores de `Task:` y `Req:` en cualquier línea del mensaje (no exige que estén en el último párrafo). */
export function parseTrailers(message) {
  const values = (key) =>
    [...message.matchAll(new RegExp(`^${key}:[ \\t]*(.*)$`, 'gmi'))].flatMap((m) =>
      m[1].split(',').map((s) => s.trim()).filter(Boolean),
    );
  return { task: values('Task'), req: values('Req') };
}

function checkSpecFiles(root, errors) {
  const specDir = join(root, 'spec');
  for (const file of listFiles(specDir)) {
    const rel = relative(specDir, file).split(sep).join('/');
    if (!ALLOWED_SPEC_FILES.includes(rel)) {
      errors.push(`spec/${rel}: archivo no permitido en spec/ (permitidos: ${ALLOWED_SPEC_FILES.join(', ')})`);
    }
  }
}

function checkTasks(root, ids, errors) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(root, 'spec/TASKS.json'), 'utf8'));
  } catch (e) {
    errors.push(`spec/TASKS.json: no es JSON válido (${e.message})`);
    return null;
  }
  if (!Array.isArray(data?.tasks)) {
    errors.push('spec/TASKS.json: falta el arreglo "tasks"');
    return null;
  }

  const tasks = new Map();
  for (const t of data.tasks) {
    if (!/^T-\d+$/.test(t?.id ?? '')) errors.push(`spec/TASKS.json: tarea con id inválido: ${JSON.stringify(t?.id)}`);
    else if (tasks.has(t.id)) errors.push(`${t.id}: id duplicado`);
    else tasks.set(t.id, t);
  }

  for (const t of tasks.values()) {
    const where = t.id;
    if (!TASK_STATUSES.includes(t.status)) errors.push(`${where}: estado desconocido "${t.status}"`);
    if (t.kind !== undefined && !TASK_KINDS.includes(t.kind)) errors.push(`${where}: kind desconocido "${t.kind}"`);
    for (const field of ['reqs', 'decisions', 'depends_on']) {
      if (t[field] !== undefined && !Array.isArray(t[field])) errors.push(`${where}: "${field}" debe ser un arreglo`);
    }
    for (const r of t.reqs ?? []) if (!ids.req.has(r)) errors.push(`${where}: ${r} no existe en spec/SPEC.md`);
    for (const d of t.decisions ?? []) if (!ids.dec.has(d)) errors.push(`${where}: ${d} no existe en spec/DECISIONS.md`);
    for (const d of t.depends_on ?? []) if (!tasks.has(d)) errors.push(`${where}: depende de ${d}, que no existe`);

    if (t.status === 'done') {
      for (const key of ['command', 'result', 'commit']) {
        if (!nonEmpty(t.evidence?.[key])) errors.push(`${where}: está "done" sin evidence.${key}`);
      }
    }

    if (t.status === 'blocked') {
      const ref = t.blocked_by;
      if (!nonEmpty(ref)) {
        errors.push(`${where}: está "blocked" sin blocked_by`);
      } else if (/^Q-\d+$/.test(ref)) {
        if (!ids.q.has(ref)) errors.push(`${where}: blocked_by ${ref} no existe en las preguntas de spec/SPEC.md`);
      } else if (![...(t.reqs ?? []), ...(t.decisions ?? []), ...(t.depends_on ?? [])].includes(ref)) {
        errors.push(`${where}: blocked_by ${ref} no figura en sus reqs, decisions ni depends_on, ni es una Q- existente`);
      }
    } else if (nonEmpty(t.blocked_by)) {
      errors.push(`${where}: tiene blocked_by pero su estado es "${t.status}"`);
    }
  }
  return tasks;
}

/** Valida trailers y archivos de un commit (histórico o en preparación). */
function checkCommit(label, message, files, tasks, ids, errors) {
  const { task, req } = parseTrailers(message);
  if (task.length !== 1) {
    errors.push(`${label}: debe tener exactamente un trailer "Task:" (T-NN o none)`);
  } else if (task[0] !== 'none' && tasks && !tasks.has(task[0])) {
    errors.push(`${label}: Task ${task[0]} no existe en spec/TASKS.json`);
  }
  if (req.length === 0) {
    errors.push(`${label}: falta el trailer "Req:" (REQ-NNN, … o none)`);
  } else if (!(req.length === 1 && req[0] === 'none')) {
    for (const r of req) if (!ids.req.has(r)) errors.push(`${label}: Req ${r} no existe en spec/SPEC.md`);
  }

  const touched = files.filter((f) => f.startsWith(PROTECTED_DIR));
  if (touched.length > 0) {
    const t = task.length === 1 ? tasks?.get(task[0]) : undefined;
    if (t?.kind !== 'spec') {
      errors.push(
        `${label}: modifica ${PROTECTED_DIR} (${touched.join(', ')}) con Task ${task[0] ?? '?'}, que no es tarea de spec`,
      );
    }
  }
}

function checkHistory(root, tasks, ids, errors) {
  let shas;
  try {
    shas = git(root, ['rev-list', '--no-merges', 'HEAD']).split('\n').filter(Boolean);
  } catch {
    return; // repo sin commits
  }
  for (const sha of shas) {
    const message = git(root, ['show', '-s', '--format=%B', sha]);
    const files = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha]).split('\n').filter(Boolean);
    checkCommit(`commit ${sha.slice(0, 7)}`, message, files, tasks, ids, errors);
  }
}

function checkPendingCommit(root, msgFile, tasks, ids, errors) {
  const message = readFileSync(msgFile, 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n');
  const files = git(root, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  checkCommit('commit en preparación', message, files, tasks, ids, errors);
}

export function run({ root, commitMsg }) {
  const errors = [];
  const ids = {
    req: declaredIds(readText(root, 'spec/SPEC.md'), 'REQ'),
    q: declaredIds(readText(root, 'spec/SPEC.md'), 'Q'),
    dec: declaredIds(readText(root, 'spec/DECISIONS.md'), 'DEC'),
  };
  checkSpecFiles(root, errors);
  const tasks = checkTasks(root, ids, errors);
  if (isGitRepo(root)) {
    checkHistory(root, tasks, ids, errors);
    if (commitMsg) checkPendingCommit(root, commitMsg, tasks, ids, errors);
  } else if (commitMsg) {
    errors.push('--commit-msg requiere un repositorio git');
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const errors = run(parseArgs(process.argv.slice(2)));
  if (errors.length > 0) {
    console.error(`check:spec: ${errors.length} error(es)`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log('check:spec: ok');
}
