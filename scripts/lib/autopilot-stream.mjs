#!/usr/bin/env node
// Live progress of the implementer (T-08): turns `claude -p --output-format stream-json --verbose` into readable
// lines. No dependencies.
//
//   claude -p … --output-format stream-json --verbose | node scripts/lib/autopilot-stream.mjs [--label T-NN] [--raw FILE] [--result FILE] [--tokens FILE]
//   node scripts/lib/autopilot-stream.mjs tokens-summary FILE [--lang es]
//
//   --label   prefix of each line (the task)
//   --raw     full copy of the stream (JSONL)
//   --result  the final `result` event as JSON (what --output-format json used to give)
//   --tokens  appends to the file (JSONL) the tokens of the `result` event's `usage` field, with the label
//   tokens-summary  prints one line per label (tokens summed over its invocations) and a last one with the total;
//                   `--lang es` for the spec/LOG.md summary, which stays in Spanish (DEC-018)
// The readable lines go to stdout; autopilot.sh copies them to the terminal and to .autopilot/<run>/live.log.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const MAX = 220;

/** First non-empty line, trimmed. */
export function oneLine(text, max = MAX) {
  const line = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Tokens of a `result` event's `usage` field; null if it has no usage. */
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

// Wording of the token lines: English for the terminal and live.log, Spanish for spec/LOG.md.
const WORDS = {
  en: { sep: ',', input: 'input', output: 'output', read: 'cache read', write: 'cache write', calls: 'invocations', total: 'total for the run', none: 'no implementer invocations' },
  es: { sep: '.', input: 'entrada', output: 'salida', read: 'caché leída', write: 'caché escrita', calls: 'invocaciones', total: 'total de la corrida', none: 'sin invocaciones del implementador' },
};

const group = (n, sep) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);

/** "input 44 · output 11,440 · cache read 1,266,786 · cache write 64,481" (`es`: "entrada 44 · salida 11.440 · …") */
export function formatUsage(u, lang = 'en') {
  const w = WORDS[lang];
  return `${w.input} ${group(u.input, w.sep)} · ${w.output} ${group(u.output, w.sep)} · ${w.read} ${group(u.cache_read, w.sep)} · ${w.write} ${group(u.cache_write, w.sep)}`;
}

/** Sum of a list of usages. */
export function sumUsage(list) {
  const t = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const u of list) for (const k of Object.keys(t)) t[k] += u[k] ?? 0;
  return t;
}

/** Records {label, ...usage} → lines "T-04: … (2 invocations)" and "total for the run: …". */
export function tokensSummary(records, lang = 'en') {
  const w = WORDS[lang];
  const by = new Map();
  for (const r of records) by.set(r.label, [...(by.get(r.label) ?? []), r]);
  const lines = [...by].map(([label, rs]) => `${label}: ${formatUsage(sumUsage(rs), lang)}${rs.length > 1 ? ` (${rs.length} ${w.calls})` : ''}`);
  lines.push(records.length ? `${w.total}: ${formatUsage(sumUsage(records), lang)}` : `${w.total}: ${w.none}`);
  return lines;
}

function toolSummary(name, input = {}) {
  if (name === 'TodoWrite' && Array.isArray(input.todos)) {
    const doing = input.todos.find((t) => t.status === 'in_progress');
    return `${input.todos.length} todos${doing ? ` · now: ${doing.content ?? doing.activeForm}` : ''}`;
  }
  for (const k of ['command', 'file_path', 'notebook_path', 'pattern', 'path', 'url', 'query', 'description', 'prompt']) {
    if (typeof input[k] === 'string' && input[k]) {
      return k === 'pattern' && input.path ? `${input[k]} in ${input.path}` : input[k];
    }
  }
  return JSON.stringify(input);
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c?.type === 'text' ? c.text : `[${c?.type}]`)).join('\n');
  return '';
}

/** Readable lines (without prefix) for a stream event; [] if it adds nothing. */
export function formatEvent(ev) {
  const out = [];
  switch (ev?.type) {
    case 'system':
      if (ev.subtype === 'init') out.push(`· start (model ${ev.model ?? '?'}, session ${ev.session_id ?? '?'})`);
      else if (ev.subtype === 'compact_boundary') out.push('· context compacted');
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
        out.push(c.is_error ? `  ✗ ${oneLine(text) || 'error'}` : `  ✓ ${lines} line(s)${text.trim() ? `: ${oneLine(text, 120)}` : ''}`);
      }
      break;
    case 'result': {
      const u = usageOf(ev);
      const tokens = u ? `, tokens: ${formatUsage(u)}` : '';
      const mins = typeof ev.duration_ms === 'number' ? `, ${Math.round(ev.duration_ms / 60000)} min` : '';
      out.push(`■ end (${ev.is_error ? `error: ${ev.subtype ?? '?'}` : 'ok'}): ${ev.num_turns ?? '?'} turns${tokens}${mins}`);
      if (ev.result) out.push(`■ ${oneLine(ev.result)}`);
      break;
    }
  }
  return out;
}

/** Input line → readable lines; non-JSON lines pass through as is (trimmed). */
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
    const lang = argv[2] === '--lang' && argv[3] === 'es' ? 'es' : 'en';
    let records = [];
    try {
      records = readFileSync(argv[1], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch { /* no file: no invocations */ }
    for (const l of tokensSummary(records, lang)) process.stdout.write(`${l}\n`);
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
    try { ev = JSON.parse(line); } catch { /* non-JSON line */ }
    if (ev?.type === 'result') {
      if (opt.result) writeFileSync(opt.result, `${JSON.stringify(ev)}\n`);
      const u = usageOf(ev);
      if (opt.tokens && u) appendFileSync(opt.tokens, `${JSON.stringify({ label: opt.label ?? '?', ...u })}\n`);
    }
    for (const l of formatLine(line)) process.stdout.write(`${stamp()} ${prefix}${l}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
