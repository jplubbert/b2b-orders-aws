import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { formatEvent, formatLine, oneLine, tokensSummary } from '../lib/night-stream.mjs';

const SCRIPT = fileURLToPath(new URL('../lib/night-stream.mjs', import.meta.url));

describe('night-stream formatEvent', () => {
  it('init, texto, herramientas y resultado en una línea cada uno', () => {
    expect(formatEvent({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', session_id: 'abc' })).toEqual([
      '· inicio (modelo claude-opus-5-5, sesión abc)',
    ]);
    expect(
      formatEvent({
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'no se muestra' },
            { type: 'text', text: '\nLeo AGENTS.md\ny luego más' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/repo/AGENTS.md' } },
            { type: 'tool_use', name: 'Grep', input: { pattern: 'REQ-003', path: 'spec' } },
          ],
        },
      }),
    ).toEqual(['› Leo AGENTS.md', '▸ Read  /repo/AGENTS.md', '▸ Grep  REQ-003 en spec']);
    expect(
      formatEvent({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', content: 'a\nb\nc' },
            { type: 'tool_result', is_error: true, content: [{ type: 'text', text: 'Permission denied' }] },
          ],
        },
      }),
    ).toEqual(['  ✓ 3 línea(s): a', '  ✗ Permission denied']);
    expect(
      formatEvent({
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 12,
        total_cost_usd: 1.234,
        duration_ms: 300000,
        usage: { input_tokens: 44, output_tokens: 11440, cache_read_input_tokens: 1266786, cache_creation_input_tokens: 64481 },
        result: 'Listo.',
      }),
    ).toEqual([
      '■ fin (ok): 12 turnos, tokens: entrada 44 · salida 11.440 · caché leída 1.266.786 · caché escrita 64.481, 5 min',
      '■ Listo.',
    ]);
    expect(formatEvent({ type: 'result', is_error: false, num_turns: 1 })).toEqual(['■ fin (ok): 1 turnos']);
  });

  it('TodoWrite resume la tarea en curso; eventos desconocidos no imprimen nada', () => {
    const todos = [{ content: 'a', status: 'completed' }, { content: 'correr aceptación', status: 'in_progress' }];
    expect(formatEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos } }] } })).toEqual([
      '▸ TodoWrite  2 pendientes · ahora: correr aceptación',
    ]);
    expect(formatEvent({ type: 'rate_limit_event' })).toEqual([]);
    expect(formatEvent({ type: 'system', subtype: 'hook_response' })).toEqual([]);
  });

  it('tokensSummary suma por tarea y da el total de la corrida', () => {
    const u = (input: number, output: number, cache_read: number, cache_write: number) => ({ input, output, cache_read, cache_write });
    expect(tokensSummary([{ label: 'T-03', ...u(1, 2, 3, 4) }, { label: 'T-04', ...u(10, 20, 3000, 40) }, { label: 'T-03', ...u(1, 2, 3, 4) }])).toEqual([
      'T-03: entrada 2 · salida 4 · caché leída 6 · caché escrita 8 (2 invocaciones)',
      'T-04: entrada 10 · salida 20 · caché leída 3.000 · caché escrita 40',
      'total de la corrida: entrada 12 · salida 24 · caché leída 3.006 · caché escrita 48',
    ]);
    expect(tokensSummary([])).toEqual(['total de la corrida: sin invocaciones del implementador']);
  });

  it('recorta líneas largas y deja pasar lo que no es JSON', () => {
    expect(oneLine('x'.repeat(300))).toHaveLength(220);
    expect(formatLine('Error: algo raro')).toEqual(['  | Error: algo raro']);
    expect(formatLine('   ')).toEqual([]);
  });
});

describe('night-stream CLI', () => {
  it('escribe líneas con prefijo, el flujo íntegro en --raw, el evento final en --result y sus tokens en --tokens', () => {
    const dir = mkdtempSync(join(tmpdir(), 'night-stream-'));
    try {
      const input = [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'm', session_id: 's' }),
        'basura',
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          num_turns: 2,
          is_error: false,
          usage: { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 7, cache_creation_input_tokens: 8 },
        }),
      ].join('\n');
      const tokens = join(dir, 't.jsonl');
      const args = [SCRIPT, '--label', 'T-09', '--raw', join(dir, 'r.jsonl'), '--result', join(dir, 'r.json'), '--tokens', tokens];
      const r = spawnSync('node', args, {
        input,
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      const lines = r.stdout.trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d T-09 · inicio/);
      expect(lines[1]).toMatch(/T-09 {3}\| basura$/);
      expect(readFileSync(join(dir, 'r.jsonl'), 'utf8')).toBe(`${input}\n`);
      expect(JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'))).toMatchObject({ type: 'result', num_turns: 2 });
      expect(JSON.parse(readFileSync(tokens, 'utf8'))).toEqual({ label: 'T-09', input: 5, output: 6, cache_read: 7, cache_write: 8 });
      expect(spawnSync('node', [SCRIPT, 'tokens-summary', tokens], { encoding: 'utf8' }).stdout).toBe(
        'T-09: entrada 5 · salida 6 · caché leída 7 · caché escrita 8\ntotal de la corrida: entrada 5 · salida 6 · caché leída 7 · caché escrita 8\n',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
