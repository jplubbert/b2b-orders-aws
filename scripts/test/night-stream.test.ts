import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { formatEvent, formatLine, oneLine } from '../lib/night-stream.mjs';

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
      formatEvent({ type: 'result', subtype: 'success', is_error: false, num_turns: 12, total_cost_usd: 1.234, duration_ms: 300000, result: 'Listo.' }),
    ).toEqual(['■ fin (ok): 12 turnos, US$ 1.23, 5 min', '■ Listo.']);
  });

  it('TodoWrite resume la tarea en curso; eventos desconocidos no imprimen nada', () => {
    const todos = [{ content: 'a', status: 'completed' }, { content: 'correr aceptación', status: 'in_progress' }];
    expect(formatEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos } }] } })).toEqual([
      '▸ TodoWrite  2 pendientes · ahora: correr aceptación',
    ]);
    expect(formatEvent({ type: 'rate_limit_event' })).toEqual([]);
    expect(formatEvent({ type: 'system', subtype: 'hook_response' })).toEqual([]);
  });

  it('recorta líneas largas y deja pasar lo que no es JSON', () => {
    expect(oneLine('x'.repeat(300))).toHaveLength(220);
    expect(formatLine('Error: algo raro')).toEqual(['  | Error: algo raro']);
    expect(formatLine('   ')).toEqual([]);
  });
});

describe('night-stream CLI', () => {
  it('escribe líneas con prefijo, el flujo íntegro en --raw y el evento final en --result', () => {
    const dir = mkdtempSync(join(tmpdir(), 'night-stream-'));
    try {
      const input = [
        JSON.stringify({ type: 'system', subtype: 'init', model: 'm', session_id: 's' }),
        'basura',
        JSON.stringify({ type: 'result', subtype: 'success', num_turns: 2, is_error: false }),
      ].join('\n');
      const r = spawnSync('node', [SCRIPT, '--label', 'T-09', '--raw', join(dir, 'r.jsonl'), '--result', join(dir, 'r.json')], {
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
