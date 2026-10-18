#!/usr/bin/env node
// Progreso en vivo del implementador (T-08): convierte `claude -p --output-format stream-json --verbose` en líneas
// legibles. Sin dependencias.
//
//   claude -p … --output-format stream-json --verbose | node scripts/lib/night-stream.mjs [--label T-NN] [--raw FILE] [--result FILE] [--tokens FILE]
//   node scripts/lib/night-stream.mjs tokens-summary FILE
//
//   --label   prefijo de cada línea (la tarea)
//   --raw     copia íntegra del flujo (JSONL)
//   --result  el evento final `result` como JSON (lo que antes daba --output-format json)
//   --tokens  agrega al archivo (JSONL) los tokens del campo `usage` del evento `result`, con la etiqueta
//   tokens-summary  imprime una línea por etiqueta (tokens sumados de sus invocaciones) y una última con el total
// Las líneas legibles van a stdout; night-loop.sh las duplica a la terminal y a .night-loop/<corrida>/live.log.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const MAX = 220;

/** Primera línea no vacía, recortada. */
export function oneLine(text, max = MAX) {
  const line = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Tokens del campo `usage` de un evento `result`; null si no trae usage. */
export function usageOf(ev) {
  const u = ev?.usage;
  if (!u || typeof u !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cache_read: n(u.cache_read_input_tokens),
    cache_write: n(u.cache_creation_input_tokens),
  };
}

const group = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** "entrada 44 · salida 11.440 · caché leída 1.266.786 · caché escrita 64.481" */
export function formatUsage(u) {
  return `entrada ${group(u.input)} · salida ${group(u.output)} · caché leída ${group(u.cache_read)} · caché escrita ${group(u.cache_write)}`;
}

/** Suma de una lista de usages. */
export function sumUsage(list) {
  const t = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const u of list) for (const k of Object.keys(t)) t[k] += u[k] ?? 0;
  return t;
}

/** Registros {label, ...usage} → líneas "T-04: … (2 invocaciones)" y "total de la corrida: …". */
export function tokensSummary(records) {
  const by = new Map();
  for (const r of records) by.set(r.label, [...(by.get(r.label) ?? []), r]);
  const lines = [...by].map(([label, rs]) => `${label}: ${formatUsage(sumUsage(rs))}${rs.length > 1 ? ` (${rs.length} invocaciones)` : ''}`);
  lines.push(records.length ? `total de la corrida: ${formatUsage(sumUsage(records))}` : 'total de la corrida: sin invocaciones del implementador');
  return lines;
}

function toolSummary(name, input = {}) {
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    const doing = input.todos.find((t) => t.status === 'in_progress');
    return `${input.todos.length} pendientes${doing ? ` · ahora: ${doing.content ?? doing.activeForm}` : ''}`;
  }
  for (const k of ['command', 'file_path', 'notebook_path', 'pattern', 'path', 'url', 'query', 'description', 'prompt']) {
    if (typeof input[k] === 'string' && input[k]) {
      return k === 'pattern' && input.path ? `${input[k]} en ${input.path}` : input[k];
    }
  }
  return JSON.stringify(input);
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c?.type === 'text' ? c.text : `[${c?.type}]`)).join('\n');
  return '';
}

/** Líneas legibles (sin prefijo) para un evento del flujo; [] si no aporta nada. */
export function formatEvent(ev) {
  const out = [];
  switch (ev?.type) {
    case 'system':
      if (ev.subtype === 'init') out.push(`· inicio (modelo ${ev.model ?? '?'}, sesión ${ev.session_id ?? '?'})`);
      else if (ev.subtype === 'compact_boundary') out.push('· contexto compactado');
      break;
    case 'assistant':
      for (const c of ev.message?.content ?? []) {
        if (c.type === 'text' && c.text?.trim()) out.push(`› ${oneLine(c.text)}`);
        else if (c.type === 'tool_use') out.push(`▸ ${c.name}  ${oneLine(toolSummary(c.name, c.input))}`);
      }
      break;
    case 'user':
      for (const c of Array.isArray(ev.message?.content) ? ev.message.content : []) {
        if (c.type !== 'tool_result') continue;
        const text = resultText(c.content);
        const lines = text ? text.split('\n').length : 0;
        out.push(c.is_error ? `  ✗ ${oneLine(text) || 'error'}` : `  ✓ ${lines} línea(s)${text.trim() ? `: ${oneLine(text, 120)}` : ''}`);
      }
      break;
    case 'result': {
      const u = usageOf(ev);
      const tokens = u ? `, tokens: ${formatUsage(u)}` : '';
      const mins = typeof ev.duration_ms === 'number' ? `, ${Math.round(ev.duration_ms / 60000)} min` : '';
      out.push(`■ fin (${ev.is_error ? `error: ${ev.subtype ?? '?'}` : 'ok'}): ${ev.num_turns ?? '?'} turnos${tokens}${mins}`);
      if (ev.result) out.push(`■ ${oneLine(ev.result)}`);
      break;
    }
  }
  return out;
}

/** Línea de entrada → líneas legibles; las que no son JSON pasan tal cual (recortadas). */
export function formatLine(line) {
  if (!line.trim()) return [];
  try {
    return formatEvent(JSON.parse(line));
  } catch {
    return [`  | ${oneLine(line)}`];
  }
}

async function main(argv) {
  if (argv[0] === 'tokens-summary') {
    let records = [];
    try {
      records = readFileSync(argv[1], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch { /* sin archivo: ninguna invocación */ }
    for (const l of tokensSummary(records)) process.stdout.write(`${l}\n`);
    return;
  }
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (opt.raw) writeFileSync(opt.raw, '');
  const prefix = opt.label ? `${opt.label} ` : '';
  const stamp = () => new Date().toTimeString().slice(0, 8);
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (opt.raw) appendFileSync(opt.raw, `${line}\n`);
    let ev = null;
    try { ev = JSON.parse(line); } catch { /* línea no JSON */ }
    if (ev?.type === 'result') {
      if (opt.result) writeFileSync(opt.result, `${JSON.stringify(ev)}\n`);
      const u = usageOf(ev);
      if (opt.tokens && u) appendFileSync(opt.tokens, `${JSON.stringify({ label: opt.label ?? '?', ...u })}\n`);
    }
    for (const l of formatLine(line)) process.stdout.write(`${stamp()} ${prefix}${l}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
