import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Fixtures: copia de spec/ del repo en un git temporal, mutada por cada caso.
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(REPO, 'scripts/check-spec.mjs');
const HOOK = join(REPO, '.githooks/commit-msg');

let root: string;

const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    encoding: 'utf8',
  });

function check(...extra: string[]) {
  const r = spawnSync('node', [SCRIPT, '--root', root, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

type Task = Record<string, unknown> & { id: string };
function editTasks(fn: (tasks: Task[]) => void) {
  const path = join(root, 'spec/TASKS.json');
  const data = JSON.parse(readFileSync(path, 'utf8')) as { tasks: Task[] };
  fn(data.tasks);
  writeFileSync(path, JSON.stringify(data, null, 2));
}
const task = (tasks: Task[], id: string) => tasks.find((t) => t.id === id)!;

function write(rel: string, content = 'x\n') {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function commit(message: string) {
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', message);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-spec-'));
  cpSync(join(REPO, 'spec'), join(root, 'spec'), { recursive: true });
  git('init', '-q');
  commit('Spec\n\nTask: none\nReq: none');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('check:spec', () => {
  it('pasa con la spec del repo', () => {
    expect(check()).toMatchObject({ code: 0 });
  });

  it('pasa en el repositorio real (incluido su historial)', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toContain('check:spec: ok');
  });

  it('falla si TASKS.json no es JSON válido', () => {
    write('spec/TASKS.json', '{ "tasks": [');
    expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('no es JSON válido') });
  });

  it('falla con done sin evidencia completa', () => {
    editTasks((ts) => Object.assign(task(ts, 'T-02'), { status: 'done', evidence: { command: 'npm run check:spec' } }));
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toContain('T-02: está "done" sin evidence.result');
    expect(r.out).toContain('T-02: está "done" sin evidence.commit');
    expect(r.out).not.toContain('sin evidence.command');
  });

  it('pasa con done y evidencia completa', () => {
    editTasks((ts) =>
      Object.assign(task(ts, 'T-02'), {
        status: 'done',
        evidence: { command: 'npm run check:spec', result: 'ok', commit: 'abc1234' },
      }),
    );
    expect(check()).toMatchObject({ code: 0 });
  });

  it('falla con blocked sin blocked_by', () => {
    editTasks((ts) => Object.assign(task(ts, 'T-04'), { status: 'blocked', blocked_by: null }));
    expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('T-04: está "blocked" sin blocked_by') });
  });

  it('falla con blocked cuya referencia no está en reqs/decisions/depends_on', () => {
    editTasks((ts) => Object.assign(task(ts, 'T-04'), { status: 'blocked', blocked_by: 'DEC-004' }));
    expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('blocked_by DEC-004 no figura') });
  });

  it('falla con blocked por una Q- inexistente', () => {
    editTasks((ts) => Object.assign(task(ts, 'T-04'), { status: 'blocked', blocked_by: 'Q-99' }));
    expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('Q-99 no existe') });
  });

  it.each(['DEC-005', 'T-03', 'REQ-002', 'Q-02'])('pasa con blocked referenciado a %s', (ref) => {
    editTasks((ts) => Object.assign(task(ts, 'T-04'), { status: 'blocked', blocked_by: ref }));
    expect(check()).toMatchObject({ code: 0 });
  });

  it('falla con un archivo extra en spec/', () => {
    write('spec/research.md');
    write('spec/contracts/otro.graphql');
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toContain('spec/research.md: archivo no permitido');
    expect(r.out).toContain('spec/contracts/otro.graphql: archivo no permitido');
  });

  it('falla con referencias a REQ, DEC o tareas inexistentes', () => {
    editTasks((ts) => Object.assign(task(ts, 'T-04'), { reqs: ['REQ-999'], decisions: ['DEC-999'], depends_on: ['T-99'] }));
    const r = check();
    expect(r.out).toContain('REQ-999 no existe');
    expect(r.out).toContain('DEC-999 no existe');
    expect(r.out).toContain('depende de T-99');
  });

  describe('historial', () => {
    it('falla si una tarea de implementación edita tests/acceptance/', () => {
      write('tests/acceptance/req_002.test.ts');
      commit('Catálogo\n\nTask: T-04\nReq: REQ-002');
      expect(check()).toMatchObject({
        code: 1,
        out: expect.stringContaining('modifica tests/acceptance/ (tests/acceptance/req_002.test.ts) con Task T-04'),
      });
    });

    it('falla si un commit con Task: none edita tests/acceptance/', () => {
      write('tests/acceptance/req_002.test.ts');
      commit('Arreglo\n\nTask: none\nReq: none');
      expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('con Task none') });
    });

    it('pasa si la tarea de spec (T-03) edita tests/acceptance/', () => {
      write('tests/acceptance/req_002.test.ts');
      commit('Aceptación\n\nTask: T-03\nReq: REQ-001, REQ-002, REQ-003, REQ-004');
      expect(check()).toMatchObject({ code: 0 });
    });

    it('falla con commits sin trailers o con Task/Req inexistentes', () => {
      write('a.txt');
      commit('Sin trailers');
      write('b.txt');
      commit('Inventado\n\nTask: T-99\nReq: REQ-999');
      const r = check();
      expect(r.out).toMatch(/debe tener exactamente un trailer "Task:"/);
      expect(r.out).toMatch(/falta el trailer "Req:"/);
      expect(r.out).toContain('Task T-99 no existe');
      expect(r.out).toContain('Req REQ-999 no existe');
    });

    it('acepta "Req: N/A" solo en commits de tareas tooling (T-08)', () => {
      write('a.txt');
      commit('Orquestador\n\nTask: T-08\nReq: N/A');
      expect(check()).toMatchObject({ code: 0 });
      write('b.txt');
      commit('Catálogo\n\nTask: T-04\nReq: N/A');
      write('c.txt');
      commit('Suelto\n\nTask: none\nReq: n/a');
      const r = check();
      expect(r.code).toBe(1);
      expect(r.out.match(/"Req: N\/A" solo se admite en tareas con kind "tooling"/g)).toHaveLength(2);
    });

    it('rechaza un kind desconocido', () => {
      editTasks((ts) => Object.assign(task(ts, 'T-08'), { kind: 'ops' }));
      expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('T-08: kind desconocido "ops"') });
    });

    it('acepta Task/Req en un párrafo anterior a Co-Authored-By', () => {
      write('a.txt');
      commit('Algo\n\nTask: T-02\nReq: none\n\nCo-Authored-By: X <x@example.com>');
      expect(check()).toMatchObject({ code: 0 });
    });
  });

  describe('hook commit-msg', () => {
    beforeEach(() => {
      git('config', 'core.hooksPath', join(REPO, '.githooks'));
    });

    const tryCommit = (message: string) => {
      git('add', '-A');
      return spawnSync(
        'git',
        ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', message],
        { encoding: 'utf8' },
      );
    };

    it('es ejecutable', () => {
      expect(spawnSync('test', ['-x', HOOK]).status).toBe(0);
    });

    it('rechaza un commit sin trailers', () => {
      write('a.txt');
      const r = tryCommit('Sin trailers');
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('commit en preparación: debe tener exactamente un trailer "Task:"');
    });

    it('rechaza una tarea de implementación que edita tests/acceptance/', () => {
      write('tests/acceptance/req_003.test.ts');
      const r = tryCommit('Pedido\n\nTask: T-05\nReq: REQ-003');
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('modifica tests/acceptance/');
    });

    it('acepta un commit con trailers válidos', () => {
      write('a.txt');
      const r = tryCommit('Algo\n\nTask: T-02\nReq: none');
      expect(r.status).toBe(0);
    });
  });
});
