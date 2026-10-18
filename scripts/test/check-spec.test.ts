import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Fixtures: a copy of the repo's spec/ in a temporary git repo, mutated by each case.
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
  it("passes with the repo's spec", () => {
    expect(check()).toMatchObject({ code: 0 });
  });

  it('passes on the real repository (including its history)', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toContain('check:spec: ok');
  });

  it('fails if TASKS.json is not valid JSON', () => {
    write('spec/TASKS.json', '{ "tasks": [');
    expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('not valid JSON') });
  });

  it('fails with done without complete evidence', () => {
    editTasks((ts) => Object.assign(task(ts, 'T-02'), { status: 'done', evidence: { command: 'npm run check:spec' } }));
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toContain('T-02: is "done" without evidence.result');
    expect(r.out).toContain('T-02: is "done" without evidence.commit');
    expect(r.out).not.toContain('without evidence.command');
  });

  it('passes with done and complete evidence', () => {
    editTasks((ts) =>
      Object.assign(task(ts, 'T-02'), {
        status: 'done',
        evidence: { command: 'npm run check:spec', result: 'ok', commit: 'abc1234' },
      }),
    );
    expect(check()).toMatchObject({ code: 0 });
  });

  it('fails with blocked without blocked_by', () => {
    editTasks((ts) => Object.assign(task(ts, 'T-04'), { status: 'blocked', blocked_by: null }));
    expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('T-04: is "blocked" without blocked_by') });
  });

  it('fails with blocked whose reference is not in reqs/decisions/depends_on', () => {
    editTasks((ts) => Object.assign(task(ts, 'T-04'), { status: 'blocked', blocked_by: 'DEC-004' }));
    expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('blocked_by DEC-004 is not in') });
  });

  it('fails with blocked by a missing Q-', () => {
    editTasks((ts) => Object.assign(task(ts, 'T-04'), { status: 'blocked', blocked_by: 'Q-99' }));
    expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('Q-99 does not exist') });
  });

  it.each(['DEC-005', 'T-03', 'REQ-002', 'Q-02'])('passes with blocked referencing %s', (ref) => {
    editTasks((ts) => Object.assign(task(ts, 'T-04'), { status: 'blocked', blocked_by: ref }));
    expect(check()).toMatchObject({ code: 0 });
  });

  it('fails with an extra file in spec/', () => {
    write('spec/research.md');
    write('spec/contracts/other.graphql');
    const r = check();
    expect(r.code).toBe(1);
    expect(r.out).toContain('spec/research.md: file not allowed');
    expect(r.out).toContain('spec/contracts/other.graphql: file not allowed');
  });

  it('fails with references to missing REQs, DECs or tasks', () => {
    editTasks((ts) => Object.assign(task(ts, 'T-04'), { reqs: ['REQ-999'], decisions: ['DEC-999'], depends_on: ['T-99'] }));
    const r = check();
    expect(r.out).toContain('REQ-999 does not exist');
    expect(r.out).toContain('DEC-999 does not exist');
    expect(r.out).toContain('depends on T-99');
  });

  describe('history', () => {
    it('fails if an implementation task edits tests/acceptance/', () => {
      write('tests/acceptance/req_002.test.ts');
      commit('Catalog\n\nTask: T-04\nReq: REQ-002');
      expect(check()).toMatchObject({
        code: 1,
        out: expect.stringContaining('modifies tests/acceptance/ (tests/acceptance/req_002.test.ts) with Task T-04'),
      });
    });

    it('fails if a commit with Task: none edits tests/acceptance/', () => {
      write('tests/acceptance/req_002.test.ts');
      commit('Fix\n\nTask: none\nReq: none');
      expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('with Task none') });
    });

    it('passes if the spec task (T-03) edits tests/acceptance/', () => {
      write('tests/acceptance/req_002.test.ts');
      commit('Acceptance\n\nTask: T-03\nReq: REQ-001, REQ-002, REQ-003, REQ-004');
      expect(check()).toMatchObject({ code: 0 });
    });

    it('fails with commits without trailers or with missing Task/Req', () => {
      write('a.txt');
      commit('No trailers');
      write('b.txt');
      commit('Made up\n\nTask: T-99\nReq: REQ-999');
      const r = check();
      expect(r.out).toMatch(/must have exactly one "Task:" trailer/);
      expect(r.out).toMatch(/missing the "Req:" trailer/);
      expect(r.out).toContain('Task T-99 does not exist');
      expect(r.out).toContain('Req REQ-999 does not exist');
    });

    it('accepts "Req: N/A" only in commits of tooling tasks (T-08)', () => {
      write('a.txt');
      commit('Orchestrator\n\nTask: T-08\nReq: N/A');
      expect(check()).toMatchObject({ code: 0 });
      write('b.txt');
      commit('Catalog\n\nTask: T-04\nReq: N/A');
      write('c.txt');
      commit('Loose\n\nTask: none\nReq: n/a');
      const r = check();
      expect(r.code).toBe(1);
      expect(r.out.match(/"Req: N\/A" is only allowed for tasks with kind "tooling"/g)).toHaveLength(2);
    });

    it('rejects an unknown kind', () => {
      editTasks((ts) => Object.assign(task(ts, 'T-08'), { kind: 'ops' }));
      expect(check()).toMatchObject({ code: 1, out: expect.stringContaining('T-08: unknown kind "ops"') });
    });

    it('accepts Task/Req in a paragraph before Co-Authored-By', () => {
      write('a.txt');
      commit('Something\n\nTask: T-02\nReq: none\n\nCo-Authored-By: X <x@example.com>');
      expect(check()).toMatchObject({ code: 0 });
    });
  });

  describe('commit-msg hook', () => {
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

    it('is executable', () => {
      expect(spawnSync('test', ['-x', HOOK]).status).toBe(0);
    });

    it('rejects a commit without trailers', () => {
      write('a.txt');
      const r = tryCommit('No trailers');
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('pending commit: must have exactly one "Task:" trailer');
    });

    it('rejects an implementation task that edits tests/acceptance/', () => {
      write('tests/acceptance/req_003.test.ts');
      const r = tryCommit('Order\n\nTask: T-05\nReq: REQ-003');
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('modifies tests/acceptance/');
    });

    it('accepts a commit with valid trailers', () => {
      write('a.txt');
      const r = tryCommit('Something\n\nTask: T-02\nReq: none');
      expect(r.status).toBe(0);
    });
  });
});
