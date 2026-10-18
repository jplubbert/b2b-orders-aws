#!/usr/bin/env node
// Progreso en vivo del implementador (T-08): convierte `claude -p --output-format stream-json --verbose` en líneas
// legibles. Sin dependencias.
//
//   claude -p … --output-format stream-json --verbose | node scripts/lib/night-stream.mjs [--label T-NN] [--raw FILE] [--result FILE]
//
//   --label   prefijo de cada línea (la tarea)
//   --raw     copia íntegra del flujo (JSONL)
//   --result  el evento final `result` como JSON (lo que antes daba --output-format json)
// Las líneas legibles van a stdout; night-loop.sh las duplica a la terminal y a .night-loop/<corrida>/live.log.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const MAX = 220;

/** Primera línea no vacía, recortada. */
export function oneLine(text, max = MAX) {
  const line = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
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
      const cost = typeof ev.total_cost_usd === 'number' ? `, US$ ${ev.total_cost_usd.toFixed(2)}` : '';
      const mins = typeof ev.duration_ms === 'number' ? `, ${Math.round(ev.duration_ms / 60000)} min` : '';
      out.push(`■ fin (${ev.is_error ? `error: ${ev.subtype ?? '?'}` : 'ok'}): ${ev.num_turns ?? '?'} turnos${cost}${mins}`);
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
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (opt.raw) writeFileSync(opt.raw, '');
  const prefix = opt.label ? `${opt.label} ` : '';
  const stamp = () => new Date().toTimeString().slice(0, 8);
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (opt.raw) appendFileSync(opt.raw, `${line}\n`);
    if (opt.result) {
      try {
        const ev = JSON.parse(line);
        if (ev?.type === 'result') writeFileSync(opt.result, `${JSON.stringify(ev)}\n`);
      } catch { /* línea no JSON */ }
    }
    for (const l of formatLine(line)) process.stdout.write(`${stamp()} ${prefix}${l}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
