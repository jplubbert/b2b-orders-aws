import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Fixtures: copia de una spec/ fija (scripts/test/fixtures/night-spec) en un directorio temporal, mutada por cada caso.
// No se usa spec/ del repo: su estado real cambia con el proyecto.
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SPEC_FIXTURE = join(REPO, 'scripts/test/fixtures/night-spec');
const SCRIPT = join(REPO, 'scripts/lib/night-tasks.mjs');
const LOOP = join(REPO, 'scripts/night-loop.sh');

let root: string;

function run(...args: string[]) {
  const r = spawnSync('node', [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

type Task = Record<string, unknown> & { id: string; status: string };
function readTasks(): Task[] {
  return (JSON.parse(readFileSync(join(root, 'spec/TASKS.json'), 'utf8')) as { tasks: Task[] }).tasks;
}
function editTasks(fn: (tasks: Task[]) => void) {
  const path = join(root, 'spec/TASKS.json');
  const data = JSON.parse(readFileSync(path, 'utf8')) as { tasks: Task[] };
  fn(data.tasks);
  writeFileSync(path, JSON.stringify(data, null, 2));
}
const task = (tasks: Task[], id: string) => tasks.find((t) => t.id === id)!;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'night-tasks-'));
  cpSync(SPEC_FIXTURE, join(root, 'spec'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('night-tasks pick', () => {
  it('no elige nada si ninguna ready tiene sus dependencias cerradas', () => {
    // En la fixture T-03..T-07 esperan a T-01 (in_progress); T-08 está in_progress.
    editTasks((ts) => ts.forEach((t) => { if (t.status === 'ready') t.status = 'approved_for_impl'; }));
    expect(run('pick')).toMatchObject({ code: 0, out: 'null\n' });
  });

  it('elige la primera ready cuyas dependencias están done/accepted/delivered', () => {
    editTasks((ts) => {
      task(ts, 'T-01').status = 'done';
      task(ts, 'T-03').status = 'ready'; // depende de T-01
      task(ts, 'T-04').status = 'ready'; // depende de T-01 y T-03 (T-03 no cerrada)
    });
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-03', kind: 'spec' });
    editTasks((ts) => { task(ts, 'T-03').status = 'accepted'; });
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-04', kind: 'impl', reqs: ['REQ-002'] });
  });

  it('salta una ready cuya dependencia sigue abierta', () => {
    editTasks((ts) => { task(ts, 'T-03').status = 'ready'; }); // T-01 in_progress
    expect(run('pick').out).toBe('null\n');
  });

  it('--task fuerza una tarea concreta aunque no esté ready', () => {
    expect(JSON.parse(run('pick', '--task', 'T-08').out)).toMatchObject({ id: 'T-08', kind: 'tooling' });
    expect(run('pick', '--task', 'T-99')).toMatchObject({ code: 1, err: expect.stringContaining('T-99 no existe') });
  });
});

describe('night-tasks check-authority', () => {
  it('detecta estados reservados otorgados por el ejecutor', () => {
    const snap = join(root, 'before.json');
    writeFileSync(snap, run('snapshot').out);
    expect(run('check-authority', snap).code).toBe(0);
    editTasks((ts) => { task(ts, 'T-02').status = 'reviewed'; task(ts, 'T-04').status = 'in_progress'; });
    const r = run('check-authority', snap);
    expect(r.code).toBe(1);
    expect(r.err).toContain('T-02: verified_auto → reviewed');
    expect(r.err).not.toContain('T-04');
  });

  it('acepta accepted si ya lo estaba antes', () => {
    editTasks((ts) => { task(ts, 'T-02').status = 'accepted'; });
    const snap = join(root, 'before.json');
    writeFileSync(snap, run('snapshot').out);
    expect(run('check-authority', snap).code).toBe(0);
  });
});

describe('night-tasks context', () => {
  it('incluye la tarea, sus REQ completos y sus DEC', () => {
    const out = run('context', 'T-04').out;
    expect(out).toContain('# Tarea T-04: Catálogo completo');
    expect(out).toContain('### REQ-002 Ver catálogo');
    expect(out).toContain('## DEC-005');
    expect(out).toContain('## DEC-006');
    expect(out).not.toContain('### REQ-003');
    expect(out).not.toContain('## DEC-004');
  });

  it('sin REQ, declara que la descripción hace de requisito', () => {
    const out = run('context', 'T-08').out;
    expect(out).toContain('(sin REQ de producto)');
    expect(out).toContain('Verificación declarada:');
  });
});

describe('night-tasks parse-verdict', () => {
  const parse = (text: string) => {
    const f = join(root, 'out.txt');
    writeFileSync(f, text);
    return run('parse-verdict', f);
  };

  it('extrae el bloque json final', () => {
    const r = parse('Análisis…\n```json\n{"verdict":"rejected","findings":["REQ-002: falta E3"],"notes":"x"}\n```\n');
    expect(JSON.parse(r.out)).toEqual({ verdict: 'rejected', findings: ['REQ-002: falta E3'], notes: 'x' });
  });

  it('acepta un objeto JSON a secas (salida de --output-schema)', () => {
    expect(JSON.parse(parse('{"verdict":"Approved","findings":[]}').out)).toMatchObject({ verdict: 'approved' });
  });

  it('usa el último bloque cuando hay varios', () => {
    const r = parse('```json\n{"verdict":"approved","findings":[]}\n```\nCorrijo:\n```json\n{"verdict":"rejected","findings":["DEC-004: x"]}\n```');
    expect(JSON.parse(r.out).verdict).toBe('rejected');
  });

  it('falla sin veredicto o con veredicto desconocido', () => {
    expect(parse('No hay bloque.').code).toBe(1);
    expect(parse('```json\n{"verdict":"maybe"}\n```').code).toBe(1);
  });
});

describe('night-tasks set-review', () => {
  const verdict = (v: object) => {
    const f = join(root, 'verdict.json');
    writeFileSync(f, JSON.stringify(v));
    return f;
  };

  it('approved sobre verified_auto pasa a reviewed y guarda review', () => {
    const r = run('set-review', 'T-02', verdict({ verdict: 'approved', findings: [], notes: 'ok', reviewer: 'codex' }));
    expect(r).toMatchObject({ code: 0, out: 'reviewed\n' });
    const t = task(readTasks(), 'T-02');
    expect(t.status).toBe('reviewed');
    expect(t.review).toMatchObject({ reviewer: 'codex', verdict: 'approved', findings: [], notes: 'ok' });
    expect((t.review as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejected conserva el estado y registra los hallazgos', () => {
    run('set-review', 'T-02', verdict({ verdict: 'rejected', findings: ['REQ-001: x'] }));
    const t = task(readTasks(), 'T-02');
    expect(t.status).toBe('verified_auto');
    expect(t.review).toMatchObject({ verdict: 'rejected', findings: ['REQ-001: x'] });
  });

  it('approved sobre una tarea que no está verified_auto no cambia el estado', () => {
    expect(run('set-review', 'T-04', verdict({ verdict: 'approved' })).out).toBe('approved_for_impl\n');
  });

  it('rechaza veredictos inválidos', () => {
    expect(run('set-review', 'T-02', verdict({ verdict: 'ok' })).code).toBe(1);
  });
});

describe('night-loop.sh', () => {
  it('es ejecutable y --help describe el ciclo', () => {
    expect(spawnSync('test', ['-x', LOOP]).status).toBe(0);
    const r = spawnSync(LOOP, ['--help'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--dry-run');
    expect(r.stdout).toContain('Nunca hace push');
  });

  it('--dry-run no lanza nada ni modifica el repo (fixture git limpio)', () => {
    // Copia mínima del repo: scripts/, package.json y la spec/ fija, en un git temporal con árbol limpio.
    for (const d of ['scripts']) cpSync(join(REPO, d), join(root, d), { recursive: true });
    cpSync(join(REPO, 'package.json'), join(root, 'package.json'));
    const git = (...a: string[]) =>
      execFileSync('git', ['-C', root, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'base\n\nTask: none\nReq: none');
    editTasks((ts) => { task(ts, 'T-01').status = 'done'; task(ts, 'T-03').status = 'ready'; });
    git('commit', '-q', '-am', 'ready\n\nTask: none\nReq: none');
    const head = git('rev-parse', 'HEAD');
    const r = spawnSync('bash', [join(root, 'scripts/night-loop.sh'), '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: process.env.PATH, NIGHT_REVIEWER: 'claude' },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Tarea elegida: T-03');
    expect(r.stdout).toContain('claude -p Lee\\ AGENTS.md\\ y\\ ejecuta\\ T-03');
    expect(r.stdout).toContain('--disallowedTools');
    expect(r.stdout).toContain('Bash\\(git\\ push\\*\\)');
    expect(r.stdout).toContain('Entrada que se anotaría en spec/LOG.md');
    expect(git('status', '--porcelain')).toBe('');
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).not.toContain('night-loop (scripts/night-loop.sh)');
  });

  describe('ciclo completo con dobles de claude/codex', () => {
    let git: (...a: string[]) => string;
    let bin: string;
    const loop = (env: Record<string, string>, ...args: string[]) =>
      spawnSync('bash', [join(root, 'scripts/night-loop.sh'), ...args], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
      });
    const t03 = () => task(readTasks(), 'T-03') as Task & { review?: { verdict: string } };

    beforeEach(() => {
      for (const d of ['scripts', '.githooks']) cpSync(join(REPO, d), join(root, d), { recursive: true });
      cpSync(join(REPO, 'package.json'), join(root, 'package.json'));
      git = (...a: string[]) =>
        execFileSync('git', ['-C', root, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
      git('init', '-q');
      git('config', 'core.hooksPath', '.githooks');
      editTasks((ts) => { task(ts, 'T-01').status = 'done'; task(ts, 'T-01').evidence = { command: 'x', result: 'y', commit: 'z' }; task(ts, 'T-03').status = 'ready'; });
      git('add', '-A');
      git('commit', '-q', '-m', 'base\n\nTask: none\nReq: none');
      bin = join(root, '..', `night-stubs-${Date.now()}`);
      cpSync(join(REPO, 'scripts/test/fixtures/night-stubs'), bin, { recursive: true });
    });
    afterEach(() => rmSync(bin, { recursive: true, force: true }));

    it('implementa, revisa (approved → reviewed), anota LOG y confirma; nunca toca push', () => {
      const r = loop({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '1');
      expect(r.stderr.replace(/check:spec: ok\n/g, '')).toBe(''); // el hook commit-msg imprime su ok
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('veredicto sobre T-03: approved → estado reviewed');
      expect(r.stdout).toContain('parada: presupuesto de tareas alcanzado (1)');
      expect(t03()).toMatchObject({ status: 'reviewed', review: { verdict: 'approved', reviewer: expect.stringContaining('codex') } });
      const log = git('log', '--format=%s%n%b');
      expect(log).toContain('T-03: revisión independiente (approved)');
      expect(log).toContain('Orquestador nocturno: resumen');
      expect(log).toContain('Task: T-08\nReq: N/A');
      expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).toContain('Motivo de parada: presupuesto de tareas alcanzado (1)');
      expect(git('status', '--porcelain')).toBe('');
      const prompt = readFileSync(join(root, '.night-loop', readdirSync(join(root, '.night-loop')).find((d) => d.startsWith('20'))!, 'codex-received-prompt.md'), 'utf8');
      expect(prompt).toContain('### REQ-001');
      expect(prompt).toContain('## DEC-007');
      expect(prompt).toContain('stub change for T-03');
      expect(prompt).not.toContain('## DEC-001');
    });

    it('rejected conserva verified_auto y sigue; sin más ready termina con exit 0', () => {
      const r = loop({});
      expect(r.status).toBe(0);
      expect(t03()).toMatchObject({ status: 'verified_auto', review: { verdict: 'rejected', findings: [expect.stringContaining('REQ-001')] } });
      expect(r.stdout).toContain('parada: no hay tareas ready con dependencias cerradas');
    });

    it('se detiene con exit 1 si el implementador otorga accepted', () => {
      const r = loop({ STUB_MODE: 'accepted' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('T-03: ready → accepted');
      expect(r.stdout).toContain('violación de autoridad');
      expect(t03().review).toBeNull();
    });

    it('se detiene con exit 1 y sin confirmar nada si el implementador deja el árbol sucio', () => {
      const head = git('rev-parse', 'HEAD');
      const r = loop({ STUB_MODE: 'dirty' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('SIN commit');
      expect(git('rev-parse', 'HEAD')).toBe(head);
      expect(git('status', '--porcelain')).toContain('spec/LOG.md');
    });

    it('con dos fallos del implementador se detiene (exit 1) tras reintentar la misma tarea', () => {
      const r = loop({ STUB_MODE: 'fail' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('intento 2');
      expect(r.stdout).toContain('parada: 2 fallos (tope 2)');
      expect(t03().status).toBe('ready');
    });
  });

  it('se niega a correr con el árbol sucio (en ensayo solo avisa)', () => {
    cpSync(join(REPO, 'scripts'), join(root, 'scripts'), { recursive: true });
    const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
    git('init', '-q');
    const r = spawnSync('bash', [join(root, 'scripts/night-loop.sh')], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('árbol de trabajo sucio');
    const d = spawnSync('bash', [join(root, 'scripts/night-loop.sh'), '--dry-run'], { encoding: 'utf8' });
    expect(d.status).toBe(0);
    expect(d.stderr).toContain('aviso: árbol de trabajo sucio');
  });
});
