import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Fixtures: copia de una spec/ fija (scripts/test/fixtures/autopilot-spec) en un directorio temporal, mutada por cada caso.
// No se usa spec/ del repo: su estado real cambia con el proyecto.
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SPEC_FIXTURE = join(REPO, 'scripts/test/fixtures/autopilot-spec');
const SCRIPT = join(REPO, 'scripts/lib/autopilot-tasks.mjs');
const AUTOPILOT_SH = join(REPO, 'scripts/autopilot.sh');
// Credenciales falsas con [default] y [night-loop]: autopilot solo debe pasar el perfil night-loop a los hijos.
const AWS_FIXTURE = join(REPO, 'scripts/test/fixtures/autopilot-aws/credentials');

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
  root = mkdtempSync(join(tmpdir(), 'autopilot-tasks-'));
  cpSync(SPEC_FIXTURE, join(root, 'spec'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('autopilot-tasks manual-pending (DEC-011)', () => {
  it('lista evidence.manual_pending de las tareas verified_auto o reviewed; no las aceptadas', () => {
    expect(JSON.parse(run('manual-pending').out)).toEqual([]);
    editTasks((ts) => {
      task(ts, 'T-04').status = 'verified_auto';
      task(ts, 'T-04').evidence = { command: 'x', result: 'y', commit: 'z', manual_pending: ' REQ-002 E3 en el teléfono ' };
      task(ts, 'T-05').status = 'reviewed';
      task(ts, 'T-05').evidence = { command: 'x', result: 'y', commit: 'z', manual_pending: 'REQ-003 E5' };
      task(ts, 'T-06').status = 'accepted';
      task(ts, 'T-06').evidence = { command: 'x', result: 'y', commit: 'z', manual_pending: 'ya hecha' };
      task(ts, 'T-07').status = 'verified_auto';
      task(ts, 'T-07').evidence = { command: 'x', result: 'y', commit: 'z' };
    });
    expect(JSON.parse(run('manual-pending').out)).toEqual(['T-04: REQ-002 E3 en el teléfono', 'T-05: REQ-003 E5']);
  });
});

describe('autopilot-tasks pick', () => {
  it('no elige nada si ninguna elegible tiene sus dependencias cerradas', () => {
    // T-03..T-07 (approved_for_impl) esperan a T-01 (verified_auto: abierta); T-08 (in_progress) espera a T-02.
    editTasks((ts) => { task(ts, 'T-01').status = 'verified_auto'; });
    expect(run('pick')).toMatchObject({ code: 0, out: 'null\n' });
  });

  it('elige una approved_for_impl cuyas dependencias están cerradas, igual que una ready', () => {
    editTasks((ts) => { task(ts, 'T-01').status = 'accepted'; }); // T-03 approved_for_impl, depende de T-01
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-03', status: 'approved_for_impl', kind: 'spec' });
    editTasks((ts) => { task(ts, 'T-03').status = 'accepted'; }); // T-04 y T-07 (approved_for_impl) quedan elegibles: la primera
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-04', status: 'approved_for_impl' });
  });

  it('retoma una tarea in_progress con sus dependencias cerradas', () => {
    editTasks((ts) => { task(ts, 'T-01').status = 'accepted'; task(ts, 'T-03').status = 'in_progress'; });
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-03', status: 'in_progress' });
  });

  it('--exclude salta las tareas indicadas y elige la siguiente elegible', () => {
    editTasks((ts) => { task(ts, 'T-01').status = 'accepted'; task(ts, 'T-03').status = 'accepted'; });
    expect(JSON.parse(run('pick', '--exclude', 'T-04,').out)).toMatchObject({ id: 'T-07' });
    expect(run('pick', '--exclude', 'T-04,T-07')).toMatchObject({ code: 0, out: 'null\n' });
    expect(JSON.parse(run('pick', '--exclude', '').out)).toMatchObject({ id: 'T-04' });
  });

  it('no elige tareas en otros estados aunque sus dependencias estén cerradas', () => {
    editTasks((ts) => {
      task(ts, 'T-01').status = 'accepted';
      for (const id of ['T-03', 'T-04', 'T-05', 'T-06', 'T-07']) task(ts, id).status = 'verified_auto';
      task(ts, 'T-08').status = 'blocked'; // depende de T-02 (verified_auto: abierta)
      task(ts, 'T-02').status = 'accepted';
    });
    expect(run('pick').out).toBe('null\n');
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

  it('una dependencia reviewed cuenta como cerrada (encadena sin esperar accepted); verified_auto no', () => {
    editTasks((ts) => { task(ts, 'T-01').status = 'reviewed'; }); // T-03 approved_for_impl, depende de T-01
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-03' });
    editTasks((ts) => { task(ts, 'T-01').status = 'verified_auto'; });
    expect(run('pick').out).toBe('null\n');
  });

  it('salta una ready cuya dependencia sigue abierta', () => {
    editTasks((ts) => { task(ts, 'T-01').status = 'verified_auto'; task(ts, 'T-03').status = 'ready'; });
    expect(run('pick').out).toBe('null\n');
  });

  it('--task fuerza una tarea concreta aunque no esté ready', () => {
    expect(JSON.parse(run('pick', '--task', 'T-08').out)).toMatchObject({ id: 'T-08', kind: 'tooling' });
    expect(run('pick', '--task', 'T-99')).toMatchObject({ code: 1, err: expect.stringContaining('T-99 no existe') });
  });
});

describe('autopilot-tasks pending-reviews', () => {
  it('lista las tareas en verified_auto, en orden', () => {
    expect(JSON.parse(run('pending-reviews').out)).toEqual(['T-02']); // la fixture deja T-02 en verified_auto
    editTasks((ts) => { task(ts, 'T-05').status = 'verified_auto'; task(ts, 'T-02').status = 'reviewed'; });
    expect(JSON.parse(run('pending-reviews').out)).toEqual(['T-05']);
  });
});

describe('autopilot-tasks check-authority', () => {
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

describe('autopilot-tasks context', () => {
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

describe('autopilot-tasks parse-verdict', () => {
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

describe('autopilot-tasks set-review', () => {
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

describe('autopilot.sh', () => {
  it('es ejecutable y --help describe el ciclo', () => {
    expect(spawnSync('test', ['-x', AUTOPILOT_SH]).status).toBe(0);
    const r = spawnSync(AUTOPILOT_SH, ['--help'], { encoding: 'utf8' });
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
    const r = spawnSync('bash', [join(root, 'scripts/autopilot.sh'), '--dry-run'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: process.env.PATH, AUTOPILOT_REVIEWER: 'claude', AUTOPILOT_AWS_CREDENTIALS: AWS_FIXTURE },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Revisiones pendientes antes de elegir tarea (verified_auto, revisor claude): T-02');
    expect(r.stdout).toContain('Tarea elegida: T-03');
    expect(r.stdout).toContain('claude -p Lee\\ AGENTS.md\\ y\\ ejecuta\\ T-03');
    expect(r.stdout).toContain('--disallowedTools');
    expect(r.stdout).toContain('Bash\\(git\\ push\\*\\)');
    expect(r.stdout).toContain('Bash\\(npm\\ run\\ deploy\\*\\)');
    expect(r.stdout).not.toContain('Bash\\(npm\\ run\\ smoke'); // humo permitido (DEC-010)
    expect(r.stdout).toContain('--output-format stream-json --verbose');
    expect(r.stdout).toContain('sin\\ prefijos\\ de\\ entorno');
    expect(r.stdout).toContain('sin\\ \\`\\&\\&\\`\\ ni\\ \\`cd\\`');
    expect(r.stdout).toContain('Pendiente\\ deploy:');
    expect(r.stdout).toContain('AWS_PROFILE=night-loop (llave AKIANIGHTLOOPFAKE');
    expect(r.stdout).not.toContain('secreto');
    expect(r.stdout).toContain('Entrada que se anotaría en spec/LOG.md');
    expect(git('status', '--porcelain')).toBe('');
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).not.toContain('autopilot (scripts/autopilot.sh)');
  });

  describe('ciclo completo con dobles de claude/codex', () => {
    let git: (...a: string[]) => string;
    let bin: string;
    const autopilot = (env: Record<string, string>, ...args: string[]) =>
      spawnSync('bash', [join(root, 'scripts/autopilot.sh'), ...args], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AUTOPILOT_AWS_CREDENTIALS: AWS_FIXTURE, ...env },
      });
    const t03 = () => task(readTasks(), 'T-03') as Task & { review?: { verdict: string } };

    beforeEach(() => {
      for (const d of ['scripts', '.githooks']) cpSync(join(REPO, d), join(root, d), { recursive: true });
      cpSync(join(REPO, 'package.json'), join(root, 'package.json'));
      git = (...a: string[]) =>
        execFileSync('git', ['-C', root, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
      git('init', '-q');
      git('config', 'core.hooksPath', '.githooks');
      editTasks((ts) => {
        for (const id of ['T-01', 'T-02', 'T-08']) { task(ts, id).status = 'done'; task(ts, id).evidence = { command: 'x', result: 'y', commit: 'z' }; }
        task(ts, 'T-03').status = 'ready';
      });
      git('add', '-A');
      git('commit', '-q', '-m', 'base\n\nTask: none\nReq: none');
      bin = join(root, '..', `autopilot-stubs-${Date.now()}`);
      cpSync(join(REPO, 'scripts/test/fixtures/autopilot-stubs'), bin, { recursive: true });
    });
    afterEach(() => rmSync(bin, { recursive: true, force: true }));

    it('implementa, revisa (approved → reviewed), anota LOG y confirma; nunca toca push', () => {
      const r = autopilot({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '1');
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
      const prompt = readFileSync(join(root, '.autopilot', readdirSync(join(root, '.autopilot')).find((d) => d.startsWith('20'))!, 'codex-received-prompt.md'), 'utf8');
      expect(prompt).toContain('### REQ-001');
      expect(prompt).toContain('## DEC-007');
      expect(prompt).toContain('stub change for T-03');
      expect(prompt).not.toContain('## DEC-001');
    });

    const pendingT02 = () => { // T-02 implementada fuera del orquestador, esperando revisión
      editTasks((ts) => { task(ts, 'T-02').status = 'verified_auto'; });
      git('commit', '-q', '-am', 'T-02: hecho a mano\n\nTask: T-02\nReq: none');
    };
    const count = (s: string, sub: string) => s.split(sub).length - 1;

    it('antes de elegir tarea revisa las verified_auto pendientes (approved → reviewed) sin contarlas como tareas', () => {
      pendingT02();
      const r = autopilot({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '1');
      expect(r.status).toBe(0);
      const reviewed = r.stdout.indexOf('veredicto sobre T-02: approved → estado reviewed');
      expect(reviewed).toBeGreaterThan(-1);
      expect(reviewed).toBeLessThan(r.stdout.indexOf('T-03 › Empiezo la tarea'));
      expect(r.stdout).toContain('veredicto sobre T-03: approved → estado reviewed');
      expect(r.stdout).toContain('parada: presupuesto de tareas alcanzado (1)');
      expect(task(readTasks(), 'T-02')).toMatchObject({ status: 'reviewed', review: { verdict: 'approved', reviewer: expect.stringContaining('codex') } });
      expect(git('log', '--format=%s')).toContain('T-02: revisión independiente (approved)');
      expect(git('log', '-1', '--format=%b', '--grep=^T-02: revisión')).toContain('Task: T-02\nReq: none');
      expect(git('status', '--porcelain')).toBe('');
    });

    it('una pendiente rechazada queda verified_auto y no se revisa otra vez en la misma corrida', () => {
      pendingT02();
      const r = autopilot({}); // el doble de codex rechaza por defecto
      expect(r.status).toBe(0);
      expect(count(r.stdout, 'veredicto sobre T-02: rejected')).toBe(1);
      expect(count(r.stdout, 'veredicto sobre T-03: rejected')).toBe(1);
      expect(task(readTasks(), 'T-02')).toMatchObject({ status: 'verified_auto', review: { verdict: 'rejected' } });
      expect(r.stdout).toContain('parada: no hay tareas in_progress/ready/approved_for_impl con dependencias cerradas');
    });

    it('el implementador solo ve el perfil night-loop; el progreso sale legible en la terminal y en live.log', () => {
      const r = autopilot({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '1');
      expect(r.status).toBe(0);
      const runDir = join(root, '.autopilot', readdirSync(join(root, '.autopilot')).find((d) => d.startsWith('20'))!);
      const seen = readFileSync(join(root, '.autopilot/stub-env-T-03.txt'), 'utf8');
      expect(seen).toContain('AWS_PROFILE=night-loop');
      expect(seen).toContain('[night-loop]\naws_access_key_id = AKIANIGHTLOOPFAKE');
      expect(seen).toContain('[profile night-loop]\nregion = us-east-1');
      expect(seen).not.toContain('default');
      const live = readFileSync(join(runDir, 'live.log'), 'utf8');
      for (const out of [r.stdout, live]) {
        expect(out).toMatch(/T-03 › Empiezo la tarea/);
        expect(out).toMatch(/T-03 ▸ Bash {2}npm run test:acceptance/);
        expect(out).toMatch(/T-03 {3}✓ 1 línea\(s\): Tests 25 passed/);
        expect(out).toContain('T-03 ■ fin (ok): 5 turnos, tokens: entrada 44 · salida 11.440 · caché leída 1.266.786 · caché escrita 64.481');
        expect(out).toContain('tokens de T-03 en la corrida: entrada 44 · salida 11.440');
        expect(out).toContain('tokens (implementador): T-03: entrada 44 · salida 11.440 · caché leída 1.266.786 · caché escrita 64.481; total de la corrida: entrada 44');
        expect(out).not.toMatch(/costo|US\$/);
      }
      expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).toContain(
        '- Tokens (implementador, campo usage del evento result): T-03: entrada 44 · salida 11.440 · caché leída 1.266.786 · caché escrita 64.481; total de la corrida: entrada 44 · salida 11.440 · caché leída 1.266.786 · caché escrita 64.481.',
      );
      expect(live).toContain('veredicto sobre T-03: approved → estado reviewed');
      expect(readFileSync(join(runDir, 'T-03-impl-1.jsonl'), 'utf8').trim().split('\n')).toHaveLength(4);
      expect(JSON.parse(readFileSync(join(runDir, 'T-03-impl-1.json'), 'utf8'))).toMatchObject({ type: 'result', num_turns: 5 });
    });

    it('encadena: con T-03 reviewed toma T-04 (depende de T-01 y T-03) en la misma corrida', () => {
      const r = autopilot({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '2');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('veredicto sobre T-04: approved → estado reviewed');
      expect(task(readTasks(), 'T-04').status).toBe('reviewed');
    });

    it('rejected conserva verified_auto y sigue; sin más ready termina con exit 0', () => {
      const r = autopilot({});
      expect(r.status).toBe(0);
      expect(t03()).toMatchObject({ status: 'verified_auto', review: { verdict: 'rejected', findings: [expect.stringContaining('REQ-001')] } });
      expect(r.stdout).toContain('parada: no hay tareas in_progress/ready/approved_for_impl con dependencias cerradas');
    });

    it('se detiene con exit 1 si el implementador otorga accepted', () => {
      const r = autopilot({ STUB_MODE: 'accepted' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('T-03: ready → accepted');
      expect(r.stdout).toContain('violación de autoridad');
      expect(t03().review).toBeNull();
    });

    it('se detiene con exit 1 y sin confirmar nada si el implementador deja el árbol sucio', () => {
      const head = git('rev-parse', 'HEAD');
      const r = autopilot({ STUB_MODE: 'dirty' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('SIN commit');
      expect(git('rev-parse', 'HEAD')).toBe(head);
      expect(git('status', '--porcelain')).toContain('spec/LOG.md');
    });

    it('una tarea que queda sin cambios no es fallo: se salta y se toma la siguiente independiente', () => {
      editTasks((ts) => { task(ts, 'T-08').status = 'ready'; }); // depende solo de T-02 (done): independiente de T-03
      git('commit', '-q', '-am', 'T-08 ready\n\nTask: T-08\nReq: N/A');
      const r = autopilot({ STUB_NOOP: 'T-03', STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('T-03 quedó sin cambios: no cuenta como fallo');
      expect(r.stdout).not.toContain('fallo 1/');
      expect(r.stdout).not.toContain('intento 2');
      expect(r.stdout).toContain('veredicto sobre T-08: approved → estado reviewed');
      expect(r.stdout).toContain('parada: no hay tareas in_progress/ready/approved_for_impl con dependencias cerradas');
      expect(t03().status).toBe('ready');
      const log = readFileSync(join(root, 'spec/LOG.md'), 'utf8');
      expect(log).toContain('T-03: el implementador la dejó sin cambios (estado ready); se salta en esta corrida');
      expect(log).toContain('0 fallo(s)');
    });

    const t08Ready = () => { // tarea independiente de T-03 (depende solo de T-02, done)
      editTasks((ts) => { task(ts, 'T-08').status = 'ready'; });
      git('commit', '-q', '-am', 'T-08 ready\n\nTask: T-08\nReq: N/A');
    };

    it('los fallos se cuentan por tarea: dos en T-03 la abandonan y la corrida sigue con T-08', () => {
      t08Ready();
      const r = autopilot({ STUB_FAIL: 'T-03', STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' });
      expect(r.status).toBe(1); // un abandono requiere intervención
      expect(r.stdout).toContain('fallo 1/2 en T-03');
      expect(r.stdout).toContain('fallo 2/2 en T-03');
      expect(r.stdout).toContain('implementador sobre T-08 (intento 1');
      expect(r.stdout).toContain('veredicto sobre T-08: approved → estado reviewed');
      expect(t03().status).toBe('ready');
      const log = readFileSync(join(root, 'spec/LOG.md'), 'utf8');
      expect(log).toContain('T-03 abandonada en esta corrida tras 2 fallos (tope por tarea 2)');
      expect(log).toContain('1 tarea(s) completada(s), 2 fallo(s)');
    });

    it('una tarea que necesita desplegar queda in_progress con Pendiente deploy: no es fallo y sigue la siguiente', () => {
      t08Ready();
      const r = autopilot({ STUB_DEPLOY: 'T-03', STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('T-03 espera un despliegue (Pendiente deploy): no cuenta como fallo');
      expect(r.stdout).not.toContain('fallo 1/');
      expect(r.stdout).toContain('veredicto sobre T-08: approved → estado reviewed');
      expect(t03().status).toBe('in_progress');
      const log = readFileSync(join(root, 'spec/LOG.md'), 'utf8');
      expect(log).toContain('- Pendiente deploy (el usuario corre `npm run deploy:dev`; el orquestador no despliega): T-03.');
      expect(log).toContain('0 fallo(s)');
    });

    it('el resumen lista las verificaciones manuales pendientes (DEC-011)', () => {
      const r = autopilot({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '1');
      expect(r.status).toBe(0);
      expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).toContain('- Pendiente manual (el usuario la hace al aceptar en lote, DEC-011): ninguna.');
    });

    it('con dos fallos del implementador abandona la tarea (exit 1) tras reintentar la misma', () => {
      const r = autopilot({ STUB_MODE: 'fail' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('intento 2');
      expect(r.stdout).toContain('T-03 llegó al tope de 2 fallos: se abandona en esta corrida');
      expect(r.stdout).toContain('parada: no hay tareas in_progress/ready/approved_for_impl con dependencias cerradas (saltadas en esta corrida: T-03)');
      expect(r.stdout).toContain('tokens de T-03 en la corrida: entrada 6 · salida 200 · caché leída 4.000 · caché escrita 1.000 (2 invocaciones)');
      expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).toContain('total de la corrida: entrada 6 · salida 200 · caché leída 4.000 · caché escrita 1.000.');
      expect(t03().status).toBe('ready');
    });
  });

  it('se niega a correr con el árbol sucio (en ensayo solo avisa)', () => {
    cpSync(join(REPO, 'scripts'), join(root, 'scripts'), { recursive: true });
    const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
    git('init', '-q');
    const r = spawnSync('bash', [join(root, 'scripts/autopilot.sh')], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('árbol de trabajo sucio');
    const d = spawnSync('bash', [join(root, 'scripts/autopilot.sh'), '--dry-run'], { encoding: 'utf8' });
    expect(d.status).toBe(0);
    expect(d.stderr).toContain('aviso: árbol de trabajo sucio');
  });
});
