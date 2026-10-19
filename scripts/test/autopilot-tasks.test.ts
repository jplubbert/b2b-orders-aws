import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Fixtures: a copy of a fixed spec/ (scripts/test/fixtures/autopilot-spec) in a temporary directory, mutated by each case.
// The repo's spec/ is not used: its real state changes with the project.
// spec/LOG.md and spec/TASKS.json stay in Spanish; terminal, live.log, ntfy and commits are in English (DEC-018).
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SPEC_FIXTURE = join(REPO, 'scripts/test/fixtures/autopilot-spec');
const SCRIPT = join(REPO, 'scripts/lib/autopilot-tasks.mjs');
const AUTOPILOT_SH = join(REPO, 'scripts/autopilot.sh');
// Fake credentials with [default] and [autopilot]: autopilot must pass only the autopilot profile to the children.
const AWS_FIXTURE = join(REPO, 'scripts/test/fixtures/autopilot-aws/credentials');
// Without the user's local configuration (~/.config/autopilot): the tests never send real notices.
const NO_CONFIG = { AUTOPILOT_CONFIG: '/dev/null', NTFY_TOPIC: '', NTFY_URL: '' };
// claude/codex/curl doubles first in PATH: the preconditions need claude, and CI has no real one.
const STUBS = join(REPO, 'scripts/test/fixtures/autopilot-stubs');
const STUB_PATH = `${STUBS}:${process.env.PATH}`;

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
  it('lists evidence.manual_pending of verified_auto or reviewed tasks; not accepted ones', () => {
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
  it('picks nothing if no eligible task has its dependencies closed', () => {
    // T-03..T-07 (approved_for_impl) wait for T-01 (verified_auto: open); T-08 (in_progress) waits for T-02.
    editTasks((ts) => { task(ts, 'T-01').status = 'verified_auto'; });
    expect(run('pick')).toMatchObject({ code: 0, out: 'null\n' });
  });

  it('picks an approved_for_impl task whose dependencies are closed, same as a ready one', () => {
    editTasks((ts) => { task(ts, 'T-01').status = 'accepted'; }); // T-03 approved_for_impl, depends on T-01
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-03', status: 'approved_for_impl', kind: 'spec' });
    editTasks((ts) => { task(ts, 'T-03').status = 'accepted'; }); // T-04 and T-07 (approved_for_impl) become eligible: the first one
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-04', status: 'approved_for_impl' });
  });

  it('resumes an in_progress task with its dependencies closed', () => {
    editTasks((ts) => { task(ts, 'T-01').status = 'accepted'; task(ts, 'T-03').status = 'in_progress'; });
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-03', status: 'in_progress' });
  });

  it('--exclude skips the given tasks and picks the next eligible one', () => {
    editTasks((ts) => { task(ts, 'T-01').status = 'accepted'; task(ts, 'T-03').status = 'accepted'; });
    expect(JSON.parse(run('pick', '--exclude', 'T-04,').out)).toMatchObject({ id: 'T-07' });
    expect(run('pick', '--exclude', 'T-04,T-07')).toMatchObject({ code: 0, out: 'null\n' });
    expect(JSON.parse(run('pick', '--exclude', '').out)).toMatchObject({ id: 'T-04' });
  });

  it('does not pick tasks in other states even if their dependencies are closed', () => {
    editTasks((ts) => {
      task(ts, 'T-01').status = 'accepted';
      for (const id of ['T-03', 'T-04', 'T-05', 'T-06', 'T-07']) task(ts, id).status = 'verified_auto';
      task(ts, 'T-08').status = 'blocked'; // depends on T-02 (verified_auto: open)
      task(ts, 'T-02').status = 'accepted';
    });
    expect(run('pick').out).toBe('null\n');
  });

  it('picks the first ready task whose dependencies are done/accepted/delivered', () => {
    editTasks((ts) => {
      task(ts, 'T-01').status = 'done';
      task(ts, 'T-03').status = 'ready'; // depends on T-01
      task(ts, 'T-04').status = 'ready'; // depends on T-01 and T-03 (T-03 not closed)
    });
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-03', kind: 'spec' });
    editTasks((ts) => { task(ts, 'T-03').status = 'accepted'; });
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-04', kind: 'impl', reqs: ['REQ-002'] });
  });

  it('a reviewed dependency counts as closed (chains without waiting for accepted); verified_auto does not', () => {
    editTasks((ts) => { task(ts, 'T-01').status = 'reviewed'; }); // T-03 approved_for_impl, depends on T-01
    expect(JSON.parse(run('pick').out)).toMatchObject({ id: 'T-03' });
    editTasks((ts) => { task(ts, 'T-01').status = 'verified_auto'; });
    expect(run('pick').out).toBe('null\n');
  });

  it('skips a ready task whose dependency is still open', () => {
    editTasks((ts) => { task(ts, 'T-01').status = 'verified_auto'; task(ts, 'T-03').status = 'ready'; });
    expect(run('pick').out).toBe('null\n');
  });

  it('--task forces a specific task even if it is not ready', () => {
    expect(JSON.parse(run('pick', '--task', 'T-08').out)).toMatchObject({ id: 'T-08', kind: 'tooling' });
    expect(run('pick', '--task', 'T-99')).toMatchObject({ code: 1, err: expect.stringContaining('T-99 does not exist') });
  });
});

describe('autopilot-tasks pending-reviews', () => {
  it('lists the tasks in verified_auto, in order', () => {
    expect(JSON.parse(run('pending-reviews').out)).toEqual(['T-02']); // the fixture leaves T-02 in verified_auto
    editTasks((ts) => { task(ts, 'T-05').status = 'verified_auto'; task(ts, 'T-02').status = 'reviewed'; });
    expect(JSON.parse(run('pending-reviews').out)).toEqual(['T-05']);
  });
});

describe('autopilot-tasks check-authority', () => {
  it('detects reserved statuses granted by the executor', () => {
    const snap = join(root, 'before.json');
    writeFileSync(snap, run('snapshot').out);
    expect(run('check-authority', snap).code).toBe(0);
    editTasks((ts) => { task(ts, 'T-02').status = 'reviewed'; task(ts, 'T-04').status = 'in_progress'; });
    const r = run('check-authority', snap);
    expect(r.code).toBe(1);
    expect(r.err).toContain('T-02: verified_auto → reviewed');
    expect(r.err).not.toContain('T-04');
  });

  it('accepts accepted if it already was before', () => {
    editTasks((ts) => { task(ts, 'T-02').status = 'accepted'; });
    const snap = join(root, 'before.json');
    writeFileSync(snap, run('snapshot').out);
    expect(run('check-authority', snap).code).toBe(0);
  });
});

describe('autopilot-tasks context', () => {
  it('includes the task, its full REQs and its DECs', () => {
    const out = run('context', 'T-04').out;
    expect(out).toContain('# Task T-04: Catálogo completo');
    expect(out).toContain('### REQ-002 Ver catálogo');
    expect(out).toContain('## DEC-005');
    expect(out).toContain('## DEC-006');
    expect(out).not.toContain('### REQ-003');
    expect(out).not.toContain('## DEC-004');
  });

  it('without REQs, states that the description acts as the requirement', () => {
    const out = run('context', 'T-08').out;
    expect(out).toContain('(no product REQ)');
    expect(out).toContain('Declared verification:');
  });
});

describe('autopilot-tasks parse-verdict', () => {
  const parse = (text: string) => {
    const f = join(root, 'out.txt');
    writeFileSync(f, text);
    return run('parse-verdict', f);
  };

  it('extracts the final json block', () => {
    const r = parse('Analysis…\n```json\n{"verdict":"rejected","findings":["REQ-002: falta E3"],"notes":"x"}\n```\n');
    expect(JSON.parse(r.out)).toEqual({ verdict: 'rejected', findings: ['REQ-002: falta E3'], notes: 'x' });
  });

  it('accepts a bare JSON object (output of --output-schema)', () => {
    expect(JSON.parse(parse('{"verdict":"Approved","findings":[]}').out)).toMatchObject({ verdict: 'approved' });
  });

  it('uses the last block when there are several', () => {
    const r = parse('```json\n{"verdict":"approved","findings":[]}\n```\nCorrection:\n```json\n{"verdict":"rejected","findings":["DEC-004: x"]}\n```');
    expect(JSON.parse(r.out).verdict).toBe('rejected');
  });

  it('fails without a verdict or with an unknown verdict', () => {
    expect(parse('No block.').code).toBe(1);
    expect(parse('```json\n{"verdict":"maybe"}\n```').code).toBe(1);
  });
});

describe('autopilot-tasks set-review', () => {
  const verdict = (v: object) => {
    const f = join(root, 'verdict.json');
    writeFileSync(f, JSON.stringify(v));
    return f;
  };

  it('approved on verified_auto moves to reviewed and stores review', () => {
    const r = run('set-review', 'T-02', verdict({ verdict: 'approved', findings: [], notes: 'ok', reviewer: 'codex' }));
    expect(r).toMatchObject({ code: 0, out: 'reviewed\n' });
    const t = task(readTasks(), 'T-02');
    expect(t.status).toBe('reviewed');
    expect(t.review).toMatchObject({ reviewer: 'codex', verdict: 'approved', findings: [], notes: 'ok' });
    expect((t.review as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejected keeps the status and records the findings', () => {
    run('set-review', 'T-02', verdict({ verdict: 'rejected', findings: ['REQ-001: x'] }));
    const t = task(readTasks(), 'T-02');
    expect(t.status).toBe('verified_auto');
    expect(t.review).toMatchObject({ verdict: 'rejected', findings: ['REQ-001: x'] });
  });

  it('approved on a task that is not verified_auto does not change the status', () => {
    expect(run('set-review', 'T-04', verdict({ verdict: 'approved' })).out).toBe('approved_for_impl\n');
  });

  it('rejects invalid verdicts', () => {
    expect(run('set-review', 'T-02', verdict({ verdict: 'ok' })).code).toBe(1);
  });
});

describe('autopilot.sh', () => {
  it('is executable and --help describes the cycle', () => {
    expect(spawnSync('test', ['-x', AUTOPILOT_SH]).status).toBe(0);
    const r = spawnSync(AUTOPILOT_SH, ['--help'], { encoding: 'utf8', env: { ...process.env, ...NO_CONFIG } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--dry-run');
    expect(r.stdout).toContain('Never pushes');
  });

  it('--dry-run launches nothing and does not modify the repo (clean git fixture)', () => {
    // Minimal copy of the repo: scripts/, package.json and the fixed spec/, in a temporary git with a clean tree.
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
      env: { ...process.env, ...NO_CONFIG, PATH: STUB_PATH, AUTOPILOT_REVIEWER: 'claude', AUTOPILOT_AWS_CREDENTIALS: AWS_FIXTURE },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Pending reviews before picking a task (verified_auto, reviewer claude): T-02');
    expect(r.stdout).toContain('Chosen task: T-03');
    expect(r.stdout).toContain('claude -p Read\\ AGENTS.md\\ and\\ execute\\ T-03');
    expect(r.stdout).toContain('--disallowedTools');
    expect(r.stdout).toContain('Bash\\(git\\ push\\*\\)');
    expect(r.stdout).toContain('Bash\\(npm\\ run\\ deploy\\*\\)');
    expect(r.stdout).not.toContain('Bash\\(npm\\ run\\ smoke'); // smoke allowed (DEC-010)
    expect(r.stdout).toContain('--output-format stream-json --verbose');
    expect(r.stdout).toContain('without\\ environment\\ prefixes');
    expect(r.stdout).toContain('no\\ \\`\\&\\&\\`\\ and\\ no\\ \\`cd\\`');
    expect(r.stdout).toContain('Pendiente\\ deploy:');
    expect(r.stdout).toContain('AWS_PROFILE=autopilot (key AKIAAUTOPILOTFAKE');
    expect(r.stdout).not.toContain('secret-');
    expect(r.stdout).toContain('Entry that would be added to spec/LOG.md');
    expect(git('status', '--porcelain')).toBe('');
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).not.toContain('autopilot (scripts/autopilot.sh)');
  });

  describe('full cycle with claude/codex doubles', () => {
    let git: (...a: string[]) => string;
    let bin: string;
    const autopilot = (env: Record<string, string>, ...args: string[]) =>
      spawnSync('bash', [join(root, 'scripts/autopilot.sh'), ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...NO_CONFIG, PATH: `${bin}:${process.env.PATH}`, AUTOPILOT_AWS_CREDENTIALS: AWS_FIXTURE, STUB_CURL_LOG: curlLog(), ...env },
      });
    const t03 = () => task(readTasks(), 'T-03') as Task & { review?: { verdict: string } };
    const curlLog = () => join(root, '..', `${root.split('/').pop()}-curl.log`);
    // Calls to the curl double: each one is the list of its arguments.
    const curlCalls = (): string[][] => {
      let raw: string;
      try { raw = readFileSync(curlLog(), 'utf8'); } catch { return []; }
      return raw.split('\x1e').filter(Boolean).map((c) => c.split('\x1f').slice(0, -1));
    };
    const header = (call: string[], name: string) =>
      call.find((a, i) => call[i - 1] === '-H' && a.startsWith(`${name}: `))?.slice(name.length + 2);
    const body = (call: string[]) => call[call.indexOf('--data-binary') + 1]!;

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
    afterEach(() => { rmSync(bin, { recursive: true, force: true }); rmSync(curlLog(), { force: true }); });

    it('implements, reviews (approved → reviewed), writes LOG and commits; never pushes', () => {
      const r = autopilot({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '1');
      expect(r.stderr.replace(/check:spec: ok\n/g, '')).toBe(''); // the commit-msg hook prints its ok
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('verdict on T-03: approved → status reviewed');
      expect(r.stdout).toContain('stop: task budget reached (1)');
      expect(t03()).toMatchObject({ status: 'reviewed', review: { verdict: 'approved', reviewer: expect.stringContaining('codex') } });
      const log = git('log', '--format=%s%n%b');
      expect(log).toContain('T-03: independent review (approved)');
      expect(log).toContain('Autopilot: summary');
      expect(log).toContain('Task: T-08\nReq: N/A');
      expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).toContain('Motivo de parada: presupuesto de tareas alcanzado (1)');
      expect(git('status', '--porcelain')).toBe('');
      const prompt = readFileSync(join(root, '.autopilot', readdirSync(join(root, '.autopilot')).find((d) => d.startsWith('20'))!, 'codex-received-prompt.md'), 'utf8');
      expect(prompt).toContain('### REQ-001');
      expect(prompt).toContain('## DEC-007');
      expect(prompt).toContain('stub change for T-03');
      expect(prompt).not.toContain('## DEC-001');
    });

    const pendingT02 = () => { // T-02 implemented outside the orchestrator, awaiting review
      editTasks((ts) => { task(ts, 'T-02').status = 'verified_auto'; });
      git('commit', '-q', '-am', 'T-02: done by hand\n\nTask: T-02\nReq: none');
    };
    const count = (s: string, sub: string) => s.split(sub).length - 1;

    it('before picking a task it reviews pending verified_auto tasks (approved → reviewed) without counting them as tasks', () => {
      pendingT02();
      const r = autopilot({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '1');
      expect(r.status).toBe(0);
      const reviewed = r.stdout.indexOf('verdict on T-02: approved → status reviewed');
      expect(reviewed).toBeGreaterThan(-1);
      expect(reviewed).toBeLessThan(r.stdout.indexOf('T-03 › Starting the task'));
      expect(r.stdout).toContain('verdict on T-03: approved → status reviewed');
      expect(r.stdout).toContain('stop: task budget reached (1)');
      expect(task(readTasks(), 'T-02')).toMatchObject({ status: 'reviewed', review: { verdict: 'approved', reviewer: expect.stringContaining('codex') } });
      expect(git('log', '--format=%s')).toContain('T-02: independent review (approved)');
      expect(git('log', '-1', '--format=%b', '--grep=^T-02: independent review')).toContain('Task: T-02\nReq: none');
      expect(git('status', '--porcelain')).toBe('');
    });

    it('a rejected pending task stays verified_auto and is not reviewed again in the same run', () => {
      pendingT02();
      const r = autopilot({}); // the codex double rejects by default
      expect(r.status).toBe(0);
      expect(count(r.stdout, 'verdict on T-02: rejected')).toBe(1);
      expect(count(r.stdout, 'verdict on T-03: rejected')).toBe(1);
      expect(task(readTasks(), 'T-02')).toMatchObject({ status: 'verified_auto', review: { verdict: 'rejected' } });
      expect(r.stdout).toContain('stop: no in_progress/ready/approved_for_impl tasks with closed dependencies');
    });

    it('the implementer sees only the autopilot profile; progress is readable in the terminal and in live.log', () => {
      const r = autopilot({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '1');
      expect(r.status).toBe(0);
      const runDir = join(root, '.autopilot', readdirSync(join(root, '.autopilot')).find((d) => d.startsWith('20'))!);
      const seen = readFileSync(join(root, '.autopilot/stub-env-T-03.txt'), 'utf8');
      expect(seen).toContain('AWS_PROFILE=autopilot');
      expect(seen).toContain('[autopilot]\naws_access_key_id = AKIAAUTOPILOTFAKE');
      expect(seen).toContain('[profile autopilot]\nregion = us-east-1');
      expect(seen).not.toContain('default');
      const live = readFileSync(join(runDir, 'live.log'), 'utf8');
      for (const out of [r.stdout, live]) {
        expect(out).toMatch(/T-03 › Starting the task/);
        expect(out).toMatch(/T-03 ▸ Bash {2}npm run test:acceptance/);
        expect(out).toMatch(/T-03 {3}✓ 1 line\(s\): Tests 25 passed/);
        expect(out).toContain('T-03 ■ end (ok): 5 turns, tokens: input 44 · output 11,440 · cache read 1,266,786 · cache write 64,481');
        expect(out).toContain('tokens for T-03 in the run: input 44 · output 11,440');
        expect(out).toContain('tokens (implementer): T-03: input 44 · output 11,440 · cache read 1,266,786 · cache write 64,481; total for the run: input 44');
        expect(out).not.toMatch(/cost|US\$/);
      }
      expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).toContain(
        '- Tokens (implementador, campo usage del evento result): T-03: entrada 44 · salida 11.440 · caché leída 1.266.786 · caché escrita 64.481; total de la corrida: entrada 44 · salida 11.440 · caché leída 1.266.786 · caché escrita 64.481.',
      );
      expect(live).toContain('verdict on T-03: approved → status reviewed');
      expect(readFileSync(join(runDir, 'T-03-impl-1.jsonl'), 'utf8').trim().split('\n')).toHaveLength(4);
      expect(JSON.parse(readFileSync(join(runDir, 'T-03-impl-1.json'), 'utf8'))).toMatchObject({ type: 'result', num_turns: 5 });
    });

    it('chains: with T-03 reviewed it takes T-04 (depends on T-01 and T-03) in the same run', () => {
      const r = autopilot({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '2');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('verdict on T-04: approved → status reviewed');
      expect(task(readTasks(), 'T-04').status).toBe('reviewed');
    });

    it('rejected keeps verified_auto and goes on; with no more ready tasks it ends with exit 0', () => {
      const r = autopilot({});
      expect(r.status).toBe(0);
      expect(t03()).toMatchObject({ status: 'verified_auto', review: { verdict: 'rejected', findings: [expect.stringContaining('REQ-001')] } });
      expect(r.stdout).toContain('stop: no in_progress/ready/approved_for_impl tasks with closed dependencies');
    });

    it('stops with exit 1 if the implementer grants accepted', () => {
      const r = autopilot({ STUB_MODE: 'accepted' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('T-03: ready → accepted');
      expect(r.stdout).toContain('authority violation');
      expect(t03().review).toBeNull();
    });

    it('stops with exit 1 and commits nothing if the implementer leaves the tree dirty', () => {
      const head = git('rev-parse', 'HEAD');
      const r = autopilot({ STUB_MODE: 'dirty' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('WITHOUT commit');
      expect(git('rev-parse', 'HEAD')).toBe(head);
      expect(git('status', '--porcelain')).toContain('spec/LOG.md');
    });

    it('a task that ends unchanged is not a failure: it is skipped and the next independent one is taken', () => {
      editTasks((ts) => { task(ts, 'T-08').status = 'ready'; }); // depends only on T-02 (done): independent of T-03
      git('commit', '-q', '-am', 'T-08 ready\n\nTask: T-08\nReq: N/A');
      const r = autopilot({ STUB_NOOP: 'T-03', STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('T-03 ended unchanged: not counted as a failure');
      expect(r.stdout).not.toContain('failure 1/');
      expect(r.stdout).not.toContain('attempt 2');
      expect(r.stdout).toContain('verdict on T-08: approved → status reviewed');
      expect(r.stdout).toContain('stop: no in_progress/ready/approved_for_impl tasks with closed dependencies');
      expect(t03().status).toBe('ready');
      const log = readFileSync(join(root, 'spec/LOG.md'), 'utf8');
      expect(log).toContain('T-03: el implementador la dejó sin cambios (estado ready); se salta en esta corrida');
      expect(log).toContain('0 fallo(s)');
    });

    const t08Ready = () => { // task independent of T-03 (depends only on T-02, done)
      editTasks((ts) => { task(ts, 'T-08').status = 'ready'; });
      git('commit', '-q', '-am', 'T-08 ready\n\nTask: T-08\nReq: N/A');
    };

    it('failures are counted per task: two on T-03 abandon it and the run goes on with T-08', () => {
      t08Ready();
      const r = autopilot({ STUB_FAIL: 'T-03', STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' });
      expect(r.status).toBe(1); // an abandoned task needs intervention
      expect(r.stdout).toContain('failure 1/2 on T-03');
      expect(r.stdout).toContain('failure 2/2 on T-03');
      expect(r.stdout).toContain('implementer on T-08 (attempt 1');
      expect(r.stdout).toContain('verdict on T-08: approved → status reviewed');
      expect(t03().status).toBe('ready');
      const log = readFileSync(join(root, 'spec/LOG.md'), 'utf8');
      expect(log).toContain('T-03 abandonada en esta corrida tras 2 fallos (tope por tarea 2)');
      expect(log).toContain('1 tarea(s) completada(s), 2 fallo(s)');
    });

    it('a task that needs a deploy stays in_progress with Pendiente deploy: not a failure, the next one follows', () => {
      t08Ready();
      const r = autopilot({ STUB_DEPLOY: 'T-03', STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('T-03 waits for a deploy (Pendiente deploy): not counted as a failure');
      expect(r.stdout).not.toContain('failure 1/');
      expect(r.stdout).toContain('verdict on T-08: approved → status reviewed');
      expect(t03().status).toBe('in_progress');
      const log = readFileSync(join(root, 'spec/LOG.md'), 'utf8');
      expect(log).toContain('- Pendiente deploy (el usuario corre `npm run deploy:dev`; el orquestador no despliega): T-03.');
      expect(log).toContain('0 fallo(s)');
    });

    it('"Pendiente deploy: ninguno" is not a deploy: a spec task in_progress with commits waits for the user and is not a failure', () => {
      t08Ready();
      const r = autopilot({ STUB_WAIT: 'T-03', STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' });
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain('T-03 waits for a deploy');
      expect(r.stdout).toContain('T-03 waits for the user to approve the tests/acceptance/ diff (spec task): not counted as a failure');
      expect(r.stdout).not.toContain('failure 1/');
      expect(r.stdout).toContain('verdict on T-08: approved → status reviewed');
      expect(t03().status).toBe('in_progress');
      const log = readFileSync(join(root, 'spec/LOG.md'), 'utf8');
      expect(log).toContain('- Pendiente deploy (el usuario corre `npm run deploy:dev`; el orquestador no despliega): ninguna.');
      expect(log).toContain('T-03: tarea de spec in_progress; espera que el usuario apruebe el diff de tests/acceptance/');
      expect(log).toContain('0 fallo(s)');
    });

    it('"Pendiente deploy: ninguno" on a non-spec task that stays in_progress counts as a failure', () => {
      editTasks((ts) => { task(ts, 'T-08').status = 'ready'; task(ts, 'T-03').status = 'reviewed'; });
      git('commit', '-q', '-am', 'T-08 ready\n\nTask: T-08\nReq: N/A');
      const r = autopilot({ STUB_WAIT: 'T-08' }, '--task', 'T-08');
      expect(r.stdout).not.toContain('T-08 waits for a deploy');
      expect(r.stdout).toContain('failure 1/2 on T-08');
    });

    it('the summary lists the pending manual checks (DEC-011)', () => {
      const r = autopilot({ STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' }, '--max-tasks', '1');
      expect(r.status).toBe(0);
      expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).toContain('- Pendiente manual (el usuario la hace al aceptar en lote, DEC-011): ninguna.');
    });

    it('with two implementer failures it abandons the task (exit 1) after retrying the same one', () => {
      const r = autopilot({ STUB_MODE: 'fail' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('attempt 2');
      expect(r.stdout).toContain('T-03 reached the cap of 2 failures: abandoned in this run');
      expect(r.stdout).toContain('stop: no in_progress/ready/approved_for_impl tasks with closed dependencies (skipped in this run: T-03)');
      expect(r.stdout).toContain('tokens for T-03 in the run: input 6 · output 200 · cache read 4,000 · cache write 1,000 (2 invocations)');
      expect(readFileSync(join(root, 'spec/LOG.md'), 'utf8')).toContain('total de la corrida: entrada 6 · salida 200 · caché leída 4.000 · caché escrita 1.000.');
      expect(t03().status).toBe('ready');
    });

    describe('ntfy notice on stop (T-21)', () => {
      const ntfy = { NTFY_TOPIC: 'test-topic', NTFY_URL: 'https://ntfy.example' };
      const approved = { STUB_VERDICT: '{"verdict":"approved","findings":[],"notes":"ok"}' };

      it('without NTFY_TOPIC it does not call curl', () => {
        const r = autopilot(approved, '--max-tasks', '1');
        expect(r.status).toBe(0);
        expect(curlCalls()).toEqual([]);
      });

      it('if it finished fine: one normal-priority notice to the topic, with reason, done/failed and next action', () => {
        // Only T-03 is eligible: it is implemented, reviewed and the run ends with no tasks left (no limit, no failures).
        editTasks((ts) => { for (const id of ['T-04', 'T-05', 'T-06', 'T-07']) task(ts, id).status = 'accepted'; });
        git('commit', '-q', '-am', 'only T-03\n\nTask: none\nReq: none');
        const r = autopilot({ ...approved, ...ntfy });
        expect(r.status).toBe(0);
        const calls = curlCalls();
        expect(calls).toHaveLength(1);
        const c = calls[0]!;
        expect(c.at(-1)).toBe('https://ntfy.example/test-topic');
        expect(header(c, 'Priority')).toBe('default');
        expect(header(c, 'Tags')).toBe('white_check_mark');
        expect(header(c, 'Title')).toMatch(/^autopilot .*: finished fine$/);
        expect(body(c)).toContain('Stop reason: no in_progress/ready/approved_for_impl');
        expect(body(c)).toContain('Done: 1 task(s) · Failed: 0 failure(s)');
        expect(body(c)).toContain('Detail: T-03 implemented');
        expect(body(c)).toContain('Next action: review the summary in spec/LOG.md');
        expect(r.stdout).toContain('ntfy notice sent (priority default)');
      });

      it('a budget limit (tasks) asks for intervention: high priority', () => {
        const r = autopilot({ ...approved, ...ntfy }, '--max-tasks', '1');
        expect(r.status).toBe(0);
        const [c] = curlCalls();
        expect(header(c!, 'Priority')).toBe('high');
        expect(header(c!, 'Tags')).toBe('warning,rotating_light');
        expect(body(c!)).toContain('Stop reason: task budget reached (1)');
        expect(body(c!)).toContain('Next action: relaunch the autopilot to continue (limit reached)');
      });

      it('if it needs intervention (failures): high priority and alert tag, with the abandoned tasks', () => {
        const r = autopilot({ ...ntfy, STUB_MODE: 'fail' });
        expect(r.status).toBe(1);
        const [c] = curlCalls();
        expect(header(c!, 'Priority')).toBe('high');
        expect(header(c!, 'Tags')).toBe('warning,rotating_light');
        expect(header(c!, 'Title')).toMatch(/needs your intervention$/);
        expect(body(c!)).toContain('Failed: 2 failure(s); abandoned: T-03');
        expect(body(c!)).toContain('Next action: review the failures of T-03 in .autopilot/');
      });

      it('a pending deploy also asks for intervention', () => {
        const r = autopilot({ ...ntfy, ...approved, STUB_DEPLOY: 'T-03' });
        expect(r.status).toBe(0);
        const [c] = curlCalls();
        expect(header(c!, 'Priority')).toBe('high');
        expect(body(c!)).toContain('Next action: run npm run deploy:dev (T-03)');
      });

      it('a reviewer rejection asks for intervention: high priority, with the rejected task', () => {
        const r = autopilot({ ...ntfy, STUB_VERDICT: '{"verdict":"rejected","findings":["REQ-002: falta un borde"],"notes":"n"}' }, '--max-tasks', '1');
        expect(r.status).toBe(0);
        const [c] = curlCalls();
        expect(header(c!, 'Priority')).toBe('high');
        expect(body(c!)).toContain('rejected by the reviewer: T-03');
        expect(body(c!)).toContain("Next action: address the reviewer's findings (review of T-03");
      });

      it('an AUTOPILOT_NTFY_MAX below 1000 is taken as 1000: the fixed fields are complete', () => {
        const r = autopilot({ ...ntfy, STUB_MODE: 'fail', AUTOPILOT_NTFY_MAX: '110' });
        expect(r.status).toBe(1);
        const b = body(curlCalls()[0]!);
        expect(b.length <= 1000).toBe(true);
        const lines = b.split('\n');
        expect(lines[0]).toBe('Stop reason: no in_progress/ready/approved_for_impl tasks with closed dependencies (skipped in this run: T-03)');
        expect(lines[1]).toBe('Done: 0 task(s) · Failed: 2 failure(s); abandoned: T-03');
        expect(lines[2]).toMatch(/^Next action: review the failures of T-03 in \.autopilot\/[0-9_-]+\/ and relaunch$/);
        expect(lines[3]).toMatch(/^Run [0-9_-]+ \(logs in \.autopilot\/[0-9_-]+\/\)$/);
        expect(lines[4]).toMatch(/^Detail: /);
      });

      it('with many tasks: lists are shortened (5 and "(+N more)") and only the detail is trimmed to the limit', () => {
        // 7 from the fixture + 20 new ones in verified_auto: the reviewer rejects them all before picking a new task.
        editTasks((ts) => {
          for (const id of ['T-02', 'T-03', 'T-04', 'T-05', 'T-06', 'T-07', 'T-08']) { task(ts, id).status = 'verified_auto'; task(ts, id).evidence = { command: 'x', result: 'y', commit: 'z' }; }
          for (let i = 9; i <= 28; i++) ts.push({ ...task(ts, 'T-08'), id: `T-${String(i).padStart(2, '0')}`, depends_on: [] });
        });
        git('commit', '-q', '-am', 'twenty-seven to review\n\nTask: none\nReq: none');
        const r = autopilot({ ...ntfy, AUTOPILOT_NTFY_MAX: '1000', STUB_VERDICT: '{"verdict":"rejected","findings":["REQ-002: x"],"notes":"n"}' });
        expect(r.stdout).toContain('verdict on T-28: rejected');
        const b = body(curlCalls()[0]!);
        expect(b.length <= 1000).toBe(true);
        const lines = b.split('\n');
        expect(lines[1]).toBe('Done: 0 task(s) · Failed: 0 failure(s); rejected by the reviewer: T-02 T-03 T-04 T-05 T-06 … (+22 more)');
        expect(lines[2]).toBe("Next action: address the reviewer's findings (review of T-02 T-03 T-04 T-05 T-06 … (+22 more) in spec/TASKS.json)");
        expect(lines[3]).toMatch(/^Run /);
        expect(lines[4]).toMatch(/^Detail: T-02 reviewed by /);
        expect(lines[4]!.endsWith('…')).toBe(true);
      });

      it('a blocked task with a long blocked_by: the reason carries a 200-character excerpt and the notice fits', () => {
        const r = autopilot({ ...ntfy, STUB_MODE: 'blocked', STUB_BLOCKED_BY: 'x'.repeat(5000) });
        expect(r.status).toBe(1);
        const [c] = curlCalls();
        expect(header(c!, 'Priority')).toBe('high');
        const b = body(c!);
        expect(b.length <= 3000).toBe(true);
        const lines = b.split('\n');
        expect(lines[0]).toBe(`Stop reason: T-03 ended blocked (${'x'.repeat(199)}…)`);
        expect(lines[2]).toMatch(/^Next action: resolve the block \(T-03 ended blocked \(x+…\)\) and relaunch the autopilot$/);
      });

      it('if ntfy fails, the run keeps its result and the summary is committed anyway', () => {
        const r = autopilot({ ...approved, ...ntfy, STUB_CURL_RC: '7' }, '--max-tasks', '1');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('warning: ntfy failed (code 7); the run keeps its result');
        expect(git('log', '-1', '--format=%s')).toContain('Autopilot: summary of run');
        expect(git('status', '--porcelain')).toBe('');
      });

      it('if it crashes before the summary, it notifies with high priority', () => {
        const r = autopilot(ntfy, '--task', 'T-99');
        expect(r.status).not.toBe(0);
        const [c] = curlCalls();
        expect(header(c!, 'Priority')).toBe('high');
        expect(header(c!, 'Title')).toMatch(/stopped unexpectedly$/);
        expect(body(c!)).toContain(`exited with code ${r.status}`);
        expect(body(c!)).toContain('Done: 0 task(s) · Failed: 0 failure(s)');
        expect(body(c!)).toContain('Next action: check the terminal');
      });

      it('reads the topic from AUTOPILOT_CONFIG and does not pass it to the implementer', () => {
        const cfg = join(root, '..', `${root.split('/').pop()}-config.sh`);
        writeFileSync(cfg, 'NTFY_TOPIC=from-config\nNTFY_URL=https://ntfy.example\n');
        const r = autopilot({ ...approved, AUTOPILOT_CONFIG: cfg }, '--max-tasks', '1');
        expect(r.status).toBe(0);
        expect(curlCalls()[0]!.at(-1)).toBe('https://ntfy.example/from-config');
        expect(readFileSync(join(root, '.autopilot/stub-env-T-03.txt'), 'utf8')).toContain('NTFY_TOPIC=\n');
        rmSync(cfg, { force: true });
      });

      it('--dry-run shows the notice without sending it', () => {
        const r = autopilot(ntfy, '--dry-run');
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('ntfy notice that would be sent (not sent: --dry-run');
        expect(r.stdout).not.toContain('test-topic');
        expect(curlCalls()).toEqual([]);
      });
    });
  });

  it('refuses to run with a dirty tree (in a dry run it only warns)', () => {
    cpSync(join(REPO, 'scripts'), join(root, 'scripts'), { recursive: true });
    const git = (...a: string[]) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
    git('init', '-q');
    const r = spawnSync('bash', [join(root, 'scripts/autopilot.sh')], { encoding: 'utf8', env: { ...process.env, ...NO_CONFIG, PATH: STUB_PATH } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('dirty working tree');
    const d = spawnSync('bash', [join(root, 'scripts/autopilot.sh'), '--dry-run'], { encoding: 'utf8', env: { ...process.env, ...NO_CONFIG, PATH: STUB_PATH } });
    expect(d.status).toBe(0);
    expect(d.stderr).toContain('warning: dirty working tree');
  });
});
