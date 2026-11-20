import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

import * as ui from '../playwright/ui.ts';
import * as entryUtils from '../playwright/entry_utils.ts';

const utilityMocks = {
  captureScreenshot: async () => 'mock.png', cleanupJobCredentials: async () => {},
  logEarlyReturn: () => {}, logPhase: () => {},
  throwLoggedError: message => { throw new Error(message); },
};

async function loadSource(file, dependencies, globals = {}) {
  const context = createContext({ URL, console: { log() {}, error() {} },
    process: { env: { SERVICE_USER: 'fixture-user', SERVICE_PASS: 'fixture-password' }, argv: [], cwd: () => '/mock' },
    setTimeout: callback => { callback(); return 0; }, ...globals });
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const loaded = new SourceTextModule(stripTypeScriptTypes(source), { context,
    initializeImportMeta: meta => { meta.url = new URL(`../${file}`, import.meta.url).href; } });
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

function createPage(overrides = {}) {
  const state = { url: 'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index', loggedIn: false,
    hasLoginLink: true, clickFails: false, completed: false, receipt: false, loginSucceeds: true,
    completionSucceeds: true, emptyNotice: true, waits: [], clicks: [], pendingURL: null, ...overrides };
  const page = new EventEmitter();
  const context = new EventEmitter();
  context.setDefaultTimeout = ms => { state.contextActionTimeout = ms; };
  context.setDefaultNavigationTimeout = ms => { state.contextNavigationTimeout = ms; };
  context.pages = () => [page];
  const mainFrame = {};
  function locator(name) {
    return {
      first() { return this; }, or() { return this; }, filter() { return this; },
      async count() { return 0; }, async innerText() { return ''; },
      async isVisible() { return state.emptyNotice && name.includes('検索結果'); },
      async waitFor() {
        if ((name.includes('/Logout') || name === 'ログアウト') && !state.loggedIn) throw new Error('Not authenticated');
        if (name === 'ログインする' && !state.hasLoginLink) throw new Error('Login link missing');
        if (name === '抽選申込が完了しました。' && !state.completed) throw new Error('Completion not shown');
        if (name === '受付番号' && !state.receipt) throw new Error('Receipt not shown');
      },
      async click() {
        state.clicks.push(name);
        if (name === 'ログインする' && state.clickFails) throw new Error('Element remains inert');
        if (name === 'ログインする') state.url = 'https://yoyaku.harp.lg.jp/sapporo/Login';
        if (name === 'ログイン') {
          state.url = 'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Index';
          state.loggedIn = state.loginSucceeds;
          state.pendingURL?.();
        }
        if (name === '申込確定') { state.completed = state.completionSucceeds; state.receipt = state.completionSucceeds; }
        state.onClick?.(name, page);
      },
    };
  }
  Object.assign(page, {
    url: () => state.url, locator, context: () => context, mainFrame: () => mainFrame,
    getByRole: (_role, options) => locator(String(options.name)),
    getByText: name => locator(String(name)), fill: async () => {},
    waitForLoadState: async () => {}, waitForSelector: async () => {},
    waitForTimeout: async ms => { state.waits.push(ms); state.onWait?.(page); },
    setDefaultTimeout: ms => { state.actionTimeout = ms; },
    setDefaultNavigationTimeout: ms => { state.navigationTimeout = ms; },
    waitForURL: async (predicate, options) => {
      state.lastURLWaitOptions = options;
      const matches = () => predicate(new URL(state.url));
      if (matches()) return;
      return new Promise((resolve, reject) => {
        state.pendingURL = () => matches() ? resolve() : reject(new Error('URL did not change'));
      });
    },
  });
  return { page, state, context };
}

test('確定クリック後に公式の完了表示と受付番号がある場合だけ成功する', async () => {
  const flowModule = await loadSource('playwright/page/confirmation_page.ts', { '../ui': ui });
  const { page } = createPage({ url: 'https://yoyaku.harp.lg.jp/sapporo/LotRequests/InsertConfirm' });
  assert.equal(await flowModule.runConfirmationPage(page), true);
});

test('申込が拒否された場合はクリックできても成功にしない', async () => {
  const flowModule = await loadSource('playwright/page/confirmation_page.ts', { '../ui': ui });
  const { page } = createPage({ url: 'https://yoyaku.harp.lg.jp/sapporo/LotRequests/InsertConfirm', completionSucceeds: false });
  await assert.rejects(flowModule.runConfirmationPage(page), /Completion not shown/);
});

test('ログインリンクがなくてもログイン済みの根拠がなければ失敗する', async () => {
  const flowModule = await loadSource('playwright/page/login_page.ts', { '../ui': ui, '../util': utilityMocks });
  const { page } = createPage({ hasLoginLink: false });
  await assert.rejects(flowModule.runLoginPage(page), /Not authenticated/);
});

test('ログイン済みなら再ログインせず、リンクのクリック失敗は伝播する', async () => {
  const flowModule = await loadSource('playwright/page/login_page.ts', { '../ui': ui, '../util': utilityMocks });
  const authenticated = createPage({ hasLoginLink: false, loggedIn: true });
  await flowModule.runLoginPage(authenticated.page);
  assert.equal(authenticated.state.clicks.length, 0);
  const broken = createPage({ clickFails: true });
  await assert.rejects(flowModule.runLoginPage(broken.page), /inert/);
});

test('ログイン送信後はURL変化だけでなくログイン済み表示を確認する', async () => {
  const flowModule = await loadSource('playwright/page/login_page.ts', { '../ui': ui, '../util': utilityMocks });
  const accepted = createPage({ url: 'https://yoyaku.harp.lg.jp/sapporo/Login' });
  await flowModule.runLoginPage(accepted.page);
  assert.equal(accepted.state.lastURLWaitOptions.waitUntil, 'commit');
  const denied = createPage({ url: 'https://yoyaku.harp.lg.jp/sapporo/Login', loginSucceeds: false });
  await assert.rejects(flowModule.runLoginPage(denied.page), /Not authenticated/);
});

test('操作と画面遷移に有限のタイムアウトを設定する', () => {
  const { page, state } = createPage();
  ui.configurePageTimeouts(page);
  assert.equal(state.actionTimeout, 10_000);
  assert.equal(state.navigationTimeout, 30_000);
  assert.equal(state.contextActionTimeout, 10_000);
  assert.equal(state.contextNavigationTimeout, 30_000);
});

test('追加で開く探索ページにもタイムアウトと遷移前の通信監視を適用する', () => {
  const { page, context } = createPage();
  ui.configurePageTimeouts(page);
  const child = createPage();
  context.emit('page', child.page);
  const request = { resourceType: () => 'xhr', url: () => `${child.state.url}/Data`, method: () => 'GET', postData: () => null };
  child.page.emit('request', request);
  assert.throws(() => ui.assertPageRequestsSettled(child.page), /10秒/);
  child.page.emit('requestfinished', request);
  assert.doesNotThrow(() => ui.assertPageRequestsSettled(child.page));
});

test('一覧は10秒待機し、データ通信中や通信失敗を0件扱いにしない', async () => {
  const flowModule = await loadSource('playwright/page/request_status_page.ts', { '../ui': ui, '../util': utilityMocks, '../entry_utils': entryUtils });
  const filter = flowModule.REQUEST_STATUS_FILTERS[1];
  const request = { resourceType: () => 'xhr', url: () => 'https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Data', method: () => 'GET', postData: () => null };
  for (const outcome of ['empty', 'pending', 'failed', 'http-error']) {
    const { page, state } = createPage({
      onClick: (name, target) => {
        if (name !== filter.ja || outcome === 'empty') return;
        target.emit('request', request);
        if (outcome === 'failed') target.emit('requestfailed', request);
        if (outcome === 'http-error') {
          target.emit('response', { request: () => request, status: () => 500 });
          target.emit('requestfinished', request);
        }
      },
    });
    const result = flowModule.ensureRequestStatusPage(page, filter, undefined, { captureScreenshots: false });
    if (outcome === 'empty') assert.equal((await result).length, 0);
    else await assert.rejects(result, /10秒/);
    assert.deepEqual(state.waits, [10_000]);
    for (const event of ['request', 'requestfinished', 'requestfailed', 'response']) assert.equal(page.listenerCount(event), 1);
  }
});

test('監視開始前からではなく、画面遷移前から進行する通信の未完・失敗も検知する', async () => {
  const flowModule = await loadSource('playwright/page/request_status_page.ts', { '../ui': ui, '../util': utilityMocks, '../entry_utils': entryUtils });
  for (const outcome of ['pending', 'failed', 'document-error', 'missing-dom', 'completed-empty']) {
    const { page, state } = createPage({ emptyNotice: outcome !== 'missing-dom' });
    ui.configurePageTimeouts(page);
    const request = {
      resourceType: () => outcome === 'document-error' ? 'document' : 'xhr',
      url: () => state.url, isNavigationRequest: () => true, frame: () => page.mainFrame(),
      method: () => 'GET', postData: () => null,
    };
    if (outcome !== 'missing-dom') page.emit('request', request);
    if (outcome === 'failed') page.emit('requestfailed', request);
    if (outcome === 'document-error') page.emit('response', { request: () => request, status: () => 500 });
    if (outcome === 'completed-empty') page.emit('requestfinished', request);
    const result = flowModule.ensureRequestStatusPage(page, flowModule.REQUEST_STATUS_FILTERS[1], undefined, { captureScreenshots: false });
    if (outcome === 'completed-empty') assert.equal((await result).length, 0);
    else await assert.rejects(result, outcome === 'missing-dom' ? /0件として扱いません/ : /10秒/);
  }
});

function dataRequest(url, method = 'GET', body = null) {
  return { resourceType: () => 'xhr', url: () => url, method: () => method, postData: () => body };
}

test('フィルタ再取得が成功したら、置き換えられた初期通信の失敗や遅い中断を引き継がない', async () => {
  const flowModule = await loadSource('playwright/page/request_status_page.ts', { '../ui': ui, '../util': utilityMocks, '../entry_utils': entryUtils });
  const filter = flowModule.REQUEST_STATUS_FILTERS[1];
  for (const outcome of ['failed', 'http-error', 'late-abort', 'late-http-error']) {
    const previous = dataRequest('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Data?t=0');
    const current = dataRequest('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Data?t=1');
    const { page, state } = createPage({ onClick: (name, target) => {
      if (name !== filter.ja) return;
      target.emit('request', current);
      target.emit('requestfinished', current);
      if (outcome === 'late-abort') target.emit('requestfailed', previous);
      if (outcome === 'late-http-error') target.emit('response', { request: () => previous, status: () => 500 });
    } });
    ui.configurePageTimeouts(page);
    page.emit('request', previous);
    if (outcome === 'failed') page.emit('requestfailed', previous);
    if (outcome === 'http-error') {
      page.emit('response', { request: () => previous, status: () => 500 });
      page.emit('requestfinished', previous);
    }
    const result = await flowModule.ensureRequestStatusPage(page, filter, undefined, { captureScreenshots: false });
    assert.equal(result.length, 0);
    assert.deepEqual(state.waits, [10_000]);
  }
});

test('同じ一覧要求の再試行が成功した場合だけ、直前の失敗を置き換える', () => {
  for (const outcome of ['success', 'failed', 'pending', 'http-error']) {
    const { page } = createPage();
    ui.beginPageRequestScope(page);
    const previous = dataRequest(`${page.url()}/Data?t=1`);
    const current = dataRequest(`${page.url()}/Data?t=1`);
    page.emit('request', previous);
    page.emit('requestfailed', previous);
    page.emit('request', current);
    if (outcome === 'success') page.emit('requestfinished', current);
    if (outcome === 'failed') page.emit('requestfailed', current);
    if (outcome === 'http-error') {
      page.emit('response', { request: () => current, status: () => 500 });
      page.emit('requestfinished', current);
    }
    if (outcome === 'success') assert.doesNotThrow(() => ui.assertPageRequestsSettled(page));
    else assert.throws(() => ui.assertPageRequestsSettled(page), /10秒/);
  }
});

test('フィルタ変更後の要求が失敗・未完の場合は、古い失敗の除外後も失敗にする', async () => {
  const flowModule = await loadSource('playwright/page/request_status_page.ts', { '../ui': ui, '../util': utilityMocks, '../entry_utils': entryUtils });
  const filter = flowModule.REQUEST_STATUS_FILTERS[1];
  for (const outcome of ['failed', 'pending', 'http-error']) {
    const previous = dataRequest('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Data?t=0');
    const current = dataRequest('https://yoyaku.harp.lg.jp/sapporo/RequestStatuses/Data?t=1');
    const { page } = createPage({ onClick: (name, target) => {
      if (name !== filter.ja) return;
      target.emit('request', current);
      if (outcome === 'failed') target.emit('requestfailed', current);
      if (outcome === 'http-error') {
        target.emit('response', { request: () => current, status: () => 500 });
        target.emit('requestfinished', current);
      }
    } });
    ui.configurePageTimeouts(page);
    page.emit('request', previous);
    page.emit('requestfailed', previous);
    await assert.rejects(flowModule.ensureRequestStatusPage(page, filter, undefined, { captureScreenshots: false }), /10秒/);
  }
});

test('無関係な要求の成功や、同じ取得内の異なる条件の要求で失敗を消さない', () => {
  for (const outcome of ['other-endpoint', 'other-method', 'same-scope-query', 'same-scope-body']) {
    const { page } = createPage();
    ui.beginPageRequestScope(page);
    const previous = dataRequest(`${page.url()}/Data?t=0`, 'POST', 'filter=0');
    page.emit('request', previous);
    page.emit('requestfailed', previous);
    if (outcome.startsWith('other-')) ui.beginPageRequestScope(page);
    const current = dataRequest(
      `${page.url()}/${outcome === 'other-endpoint' ? 'Other' : 'Data'}?t=${outcome === 'same-scope-body' ? 0 : 1}`,
      outcome === 'other-method' ? 'GET' : 'POST',
      outcome === 'same-scope-body' ? 'filter=1' : 'filter=0',
    );
    page.emit('request', current);
    page.emit('requestfinished', current);
    assert.throws(() => ui.assertPageRequestsSettled(page), /10秒/);
  }
});

test('全件失敗・未処理は失敗終了し、成功・スキップだけの場合は正常終了する', async () => {
  const entry = { gymName: 'テスト施設', room: '全面', date: '2026-12-01', time: '09:00-10:00' };
  for (const outcome of ['failed', 'cancelled', 'success', 'skipped', 'partial']) {
    const { page } = createPage();
    let closed = false;
    const jobCount = outcome === 'partial' ? 2 : 1;
    let confirmed = 0;
    const main = await loadSource('playwright/main.ts', {
      'node:url': { pathToFileURL }, 'node:path': { default: path },
      'node:fs': { promises: { writeFile: async () => {} } }, '@playwright/test': {},
      './env': { loadEnv() {} }, './ui': ui,
      './browser': { launchChromium: async () => ({ newContext: async () => ({ newPage: async () => page }), close: async () => { closed = true; } }) },
      './util': { ...utilityMocks, fetchJob: async () => ({ entryCount: jobCount }), fetchRepresentativeEntries: async () => [entry], updateJobProgress: async () => {}, sendLineNotification: async () => {} },
      './page/login_page': { runLoginPage: async () => {} },
      './page/lot_request_page': { runLotRequestPage: async () => {} },
      './page/confirmation_page': { runConfirmationPage: async () => outcome === 'success' || (outcome === 'partial' && confirmed++ === 0) },
      './page/search_page': { runSearchPage: async () => {} },
      './page/facility_search_page': { runFacilitySearchPage: async () => {} },
      './page/facility_availability': { runFacilityAvailabilityPage: async () => {} },
      './page/facility_availability_comparison': { runFacilityAvailabilityComparisonPage: async () => {} },
      './entry_utils': entryUtils,
      './reservation_plan': { buildReservationPlan: async () => ({
        entries: outcome === 'cancelled' ? [] : outcome === 'partial' ? [entry, { ...entry, date: '2026-12-02' }] : [entry],
        failedEntries: [], totalEntries: jobCount, requestStatusEntries: outcome === 'skipped' ? [entry] : [],
      }) },
    });
    page.goto = async () => {};
    if (outcome === 'failed' || outcome === 'cancelled') await assert.rejects(main.main(), /応募に成功した枠がなく/);
    else await main.main();
    assert.equal(closed, true);
  }
});
