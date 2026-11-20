import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

async function loadModule(file, dependencies, environment, globals = {}) {
  const context = createContext({ Buffer, URL, process: { env: environment }, ...globals });
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const loaded = new SourceTextModule(stripTypeScriptTypes(source), { context });
  await loaded.link(specifier => {
    const exports = dependencies[specifier];
    if (!exports) throw new Error(`Unexpected dependency ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await loaded.evaluate();
  return loaded.namespace;
}

async function createStore() {
  const environment = { INTERNAL_API_TOKEN: 'fixture-only-server-token-with-sufficient-entropy' };
  const encrypted = await loadModule('src/lib/security/job-credentials-crypto.ts', { 'server-only': {}, 'node:crypto': crypto }, environment);
  const documents = new Map();
  const versions = new Map();
  const hooks = {};
  class FirestorePreconditionError extends Error {}
  const store = await loadModule('src/lib/api/job-store.ts', {
    'node:crypto': crypto,
    '@/lib/security/job-credentials-crypto': encrypted,
    '@/lib/github/dispatch': { dispatchJobWorkflow: async () => {} },
    '@/lib/firebase/firestore-rest': {
      FirestorePreconditionError,
      getFirestoreRestDocument: async name => documents.has(name) ? { id: name.split('/').at(-1), data: { ...documents.get(name) }, updateTime: String(versions.get(name) ?? 0) } : null,
      setFirestoreRestDocument: async (name, data) => { documents.set(name, { ...data }); versions.set(name, 1); },
      patchFirestoreRestDocument: async (name, data, fields, expectedUpdateTime) => {
        if (expectedUpdateTime && hooks.beforeMigration) {
          const callback = hooks.beforeMigration;
          delete hooks.beforeMigration;
          await callback();
        }
        if (expectedUpdateTime && expectedUpdateTime !== String(versions.get(name) ?? 0)) throw new FirestorePreconditionError('Concurrent update');
        const existing = documents.get(name);
        if (!existing) throw new Error('Missing document');
        for (const field of fields) {
          if (Object.hasOwn(data, field)) existing[field] = data[field];
          else delete existing[field];
        }
        versions.set(name, (versions.get(name) ?? 0) + 1);
      },
    },
  }, environment);
  return { store, encrypted, documents, environment, hooks };
}

test('旧形式の移行とcleanupが競合しても、削除済みの認証情報を復活させない', async () => {
  const { store, documents, hooks } = await createStore();
  documents.set('jobs/legacy-race', { userId: 'fixture-user', password: 'fixture-password' });
  hooks.beforeMigration = () => store.clearJobCredentials('legacy-race');
  const runner = await store.getJobDocumentForRunner('legacy-race');
  assert.equal(runner.data.password, undefined);
  assert.equal(documents.get('jobs/legacy-race').encryptedCredentials, undefined);
});

test('Firestore移行PATCHは取得時刻を前提条件として送り、競合を専用エラーにする', async () => {
  let requestedURL;
  let conflict = false;
  const rest = await loadModule('src/lib/firebase/firestore-rest.ts', {}, {
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'fixture-project', NEXT_PUBLIC_FIREBASE_API_KEY: 'fixture-key',
  }, { fetch: async url => {
    requestedURL = url;
    return { ok: !conflict, status: conflict ? 400 : 200, text: async () => '{"error":{"status":"FAILED_PRECONDITION"}}' };
  } });
  const updateTime = '2026-11-20T12:00:00.000000Z';
  await rest.patchFirestoreRestDocument('jobs/fixture', {}, ['password'], updateTime);
  assert.equal(requestedURL.searchParams.get('currentDocument.updateTime'), updateTime);
  assert.equal(requestedURL.searchParams.get('updateMask.fieldPaths'), 'password');
  conflict = true;
  await assert.rejects(rest.patchFirestoreRestDocument('jobs/fixture', {}, ['password'], updateTime), rest.FirestorePreconditionError);
});

test('進捗文書には平文の認証情報を保存せず、runner向けにだけ復号する', async () => {
  const { store, documents } = await createStore();
  const input = { userId: 'fixture-user', password: 'fixture-password', groupId: 'fixture-group', entryCount: 1, message: 'pending', progress: 'pending' };
  const jobId = await store.createDispatchedJob(input);
  const stored = documents.get(`jobs/${jobId}`);
  assert.equal(stored.userId, undefined);
  assert.equal(stored.password, undefined);
  assert.equal(JSON.stringify(stored).includes(input.password), false);
  assert.equal(JSON.stringify(stored).includes(input.userId), false);
  const runner = await store.getJobDocumentForRunner(jobId);
  assert.equal(runner.data.userId, input.userId);
  assert.equal(runner.data.password, input.password);
  assert.equal(runner.data.encryptedCredentials, undefined);
  await store.clearJobCredentials(jobId);
  assert.equal(documents.get(`jobs/${jobId}`).encryptedCredentials, undefined);
  assert.equal((await store.getJobDocumentForRunner(jobId)).data.password, undefined);
});

test('旧ジョブはAPI読込時に平文を除去し、失敗終了時にも認証情報を削除する', async () => {
  const { store, documents } = await createStore();
  documents.set('jobs/legacy', { userId: 'fixture-user', password: 'fixture-password', groupId: 'fixture-group', entryCount: 1 });
  const runner = await store.getJobDocumentForRunner('legacy');
  assert.equal(runner.data.password, 'fixture-password');
  assert.equal(documents.get('jobs/legacy').password, undefined);
  assert.equal(typeof documents.get('jobs/legacy').encryptedCredentials, 'string');
  await store.markJobAsFailed('legacy', 'failed');
  assert.equal(documents.get('jobs/legacy').encryptedCredentials, undefined);
  assert.equal(documents.get('jobs/legacy').status, 'failed');
});

test('暗号文の別ジョブへの流用・改ざんを拒否し、キーがなければ保存しない', async () => {
  const { store, encrypted, environment, documents } = await createStore();
  const payload = encrypted.encryptJobCredentials('job-a', { userId: 'fixture-user', password: 'fixture-password' });
  assert.throws(() => encrypted.decryptJobCredentials('job-b', payload), /Failed to decrypt/);
  const pieces = payload.split('.');
  pieces[3] = `${pieces[3][0] === 'A' ? 'B' : 'A'}${pieces[3].slice(1)}`;
  assert.throws(() => encrypted.decryptJobCredentials('job-a', pieces.join('.')), /Failed to decrypt/);
  delete environment.INTERNAL_API_TOKEN;
  await assert.rejects(store.createDispatchedJob({ userId: 'fixture-user', password: 'fixture-password' }), /INTERNAL_API_TOKEN/);
  assert.equal(documents.size, 0);
});
