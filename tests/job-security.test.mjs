import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

import { buildServiceEnvironment } from '../.github/scripts/export-service-env.mjs';
import { parseJobInput } from '../src/lib/api/job-input.ts';

const validInput = {
  userId: 'test-user',
  password: 'test-password',
  entryCount: 15,
  groupId: 'test-group',
  label: 'テスト',
};
const scriptPath = fileURLToPath(new URL('../.github/scripts/export-service-env.mjs', import.meta.url));

async function loadPostHandler(internal = false) {
  const state = { authorized: true, groupExists: true, groupLookupFails: false, jobs: [], lookups: [], logs: [] };
  const dependencies = {
    'next/server': {
      NextRequest: class {},
      NextResponse: { json: (body, { status }) => ({ body, status }) },
    },
    '@/lib/api/auth': { isAuthorizedRequest: () => state.authorized },
    '@/lib/api/job-input': { parseJobInput },
    '@/lib/api/job-store': {
      createDispatchedJob: async input => { state.jobs.push(input); return 'test-job'; },
      formatHistoryTimestamp: () => '',
      getJobDocumentForRunner: async () => null,
      patchJobDocument: async () => {},
    },
    '@/lib/firebase/firestore-rest': {
      setFirestoreRestDocument: async () => {},
      getFirestoreRestDocument: async documentPath => {
        state.lookups.push(documentPath);
        if (state.groupLookupFails) throw new Error('Simulated connection error');
        return state.groupExists ? { id: validInput.groupId } : null;
      },
    },
  };
  const context = createContext({ console: { error: (...args) => state.logs.push(args) } });
  const source = readFileSync(new URL(`../src/app/api/${internal ? 'internal/' : ''}jobs/route.ts`, import.meta.url), 'utf8');
  const routeModule = new SourceTextModule(stripTypeScriptTypes(source), { context });
  await routeModule.link(specifier => {
    const exports = dependencies[specifier];
    if (!exports) throw new Error(`Unexpected dependency: ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await routeModule.evaluate();
  return { post: routeModule.namespace.POST, state };
}

test('通常応募はGoogleログイン不要のまま、有効なグループにだけジョブを作成する', async () => {
  const { post, state } = await loadPostHandler();
  state.authorized = false;
  const response = await post({ json: async () => validInput });
  assert.equal(response.status, 201);
  assert.deepEqual(state.lookups, [`groups/${validInput.groupId}`]);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].password, validInput.password);
});

test('グループの取得障害は404と区別して503を返す', async () => {
  const { post, state } = await loadPostHandler();
  state.groupLookupFails = true;
  const response = await post({ json: async () => validInput });
  assert.equal(response.status, 503);
  assert.match(response.body.error, /再試行/);
  assert.equal(state.jobs.length, 0);
});

test('存在しないグループや不正入力ではジョブを作成しない', async () => {
  const { post, state } = await loadPostHandler();
  state.groupExists = false;
  assert.equal((await post({ json: async () => validInput })).status, 404);
  state.lookups.length = 0;
  assert.equal((await post({ json: async () => ({ ...validInput, password: 'fake\nvalue' }) })).status, 400);
  assert.equal(state.lookups.length, 0);
  assert.equal(state.jobs.length, 0);
});

test('内部APIは認証後に同じ入力検証を行う', async () => {
  const { post, state } = await loadPostHandler(true);
  state.authorized = false;
  assert.equal((await post({ json: async () => { throw new Error('Must not parse before authentication'); } })).status, 401);
  state.authorized = true;
  assert.equal((await post({ json: async () => ({ ...validInput, userId: 'fake\rvalue' }) })).status, 400);
  assert.equal(state.jobs.length, 0);
  assert.equal((await post({ json: async () => validInput })).status, 201);
  assert.equal(state.jobs.length, 1);
});

test('両APIは不正JSONを拒否し、本文を含む解析エラーをログへ出さない', async () => {
  for (const internal of [false, true]) {
    const { post, state } = await loadPostHandler(internal);
    const response = await post({ json: async () => { throw new SyntaxError('Unexpected token near fake-secret'); } });
    assert.equal(response.status, 400);
    assert.deepEqual(state.logs, [['Invalid JSON payload']]);
    assert.equal(state.jobs.length, 0);
    assert.equal(state.lookups.length, 0);
  }
});

test('通常の応募を受け付け、認証情報を加工しない', () => {
  const input = { ...validInput, password: ' fake%0A=secret $() "quoted" ' };
  assert.deepEqual(parseJobInput(input), { ok: true, input });
  assert.deepEqual(buildServiceEnvironment(input, 'reservation'), {
    SERVICE_USER: input.userId,
    SERVICE_PASS: input.password,
    PLAYWRIGHT_GROUP_ID: input.groupId,
    ENTRY_COUNT: '15',
  });
  assert.deepEqual(buildServiceEnvironment(input, 'hit'), {
    SERVICE_USER: input.userId,
    SERVICE_PASS: input.password,
  });
});

test('APIとworkflowの両方で改行・NUL・不正な型の認証情報を拒否する', () => {
  for (const field of ['userId', 'password', 'groupId']) {
    for (const value of ['', null, 123, {}, [], 'fake\nAPI_BASE_URL=https://example.invalid', 'fake\rAPI_TOKEN=changed', 'fake\n', 'fake\r', 'fake\0value']) {
      const input = { ...validInput, [field]: value };
      assert.equal(parseJobInput(input).ok, false, field);
      assert.throws(() => buildServiceEnvironment(input, 'reservation'), undefined, field);
      if (field !== 'groupId') {
        assert.throws(() => buildServiceEnvironment(input, 'hit'), undefined, field);
      }
    }
  }
});

test('不正なJSONの形、グループパス、応募件数、ラベルをAPIで拒否する', () => {
  for (const input of [null, [], 'text', true, {}, { ...validInput, userId: undefined }]) {
    assert.equal(parseJobInput(input).ok, false);
  }
  for (const groupId of ['.', '..', 'group/other']) {
    const input = { ...validInput, groupId };
    assert.equal(parseJobInput(input).ok, false);
    assert.throws(() => buildServiceEnvironment(input, 'reservation'));
  }
  for (const entryCount of [undefined, null, '15', 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const input = { ...validInput, entryCount };
    assert.equal(parseJobInput(input).ok, false);
    assert.throws(() => buildServiceEnvironment(input, 'reservation'));
  }
  for (const label of [null, 123, {}, 'fake\nlabel', 'fake\rlabel', 'fake\0label']) {
    assert.equal(parseJobInput({ ...validInput, label }).ok, false);
  }
});

test('既存データが不正でも、環境ファイルやログへ値を出力する前に失敗する', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gym-job-security-'));
  const envPath = path.join(directory, 'github-env');
  const original = 'API_BASE_URL=https://legitimate.invalid\n';
  try {
    for (const mode of ['reservation', 'hit']) {
      for (const input of [
        JSON.stringify({ ...validInput, password: 'fake\nAPI_BASE_URL=https://example.invalid' }),
        JSON.stringify({ ...validInput, password: 'fake\rvalue' }),
        JSON.stringify({ ...validInput, password: 'fake\n' }),
        JSON.stringify({ ...validInput, password: 'fake\0value' }),
        JSON.stringify({ ...validInput, password: ['fake'] }),
        '{"password":"fake-secret", invalid}',
        'null',
        '[]',
      ]) {
        writeFileSync(envPath, original);
        const result = spawnSync(process.execPath, [scriptPath, mode], {
          input,
          encoding: 'utf8',
          env: { GITHUB_ENV: envPath },
        });
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, 'Service data was invalid or could not be exported.\n');
        assert.equal(readFileSync(envPath, 'utf8'), original);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('workflowが出力できる環境変数を限定し、マスク用のパーセントをエスケープする', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gym-job-security-'));
  const envPath = path.join(directory, 'github-env');
  const input = { ...validInput, password: 'fake%0A=secret', API_BASE_URL: 'https://example.invalid' };
  try {
    const result = spawnSync(process.execPath, [scriptPath, 'reservation'], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: { GITHUB_ENV: envPath },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, '::add-mask::test-user\n::add-mask::fake%250A=secret\n');
    assert.equal(readFileSync(envPath, 'utf8'), 'SERVICE_USER=test-user\nSERVICE_PASS=fake%0A=secret\nPLAYWRIGHT_GROUP_ID=test-group\nENTRY_COUNT=15\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
