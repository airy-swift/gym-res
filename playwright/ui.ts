import type { BrowserContext, Locator, Page, Request } from '@playwright/test';

export const ACTION_TIMEOUT_MS = 10_000;
export const NAVIGATION_TIMEOUT_MS = 30_000;
const configuredContexts = new WeakSet<BrowserContext>();
const networkStates = new WeakMap<Page, { pending: Set<Request>; failed: Set<Request>; scope: number }>();

export function configurePageTimeouts(page: Page): void {
  const context = page.context();
  context.setDefaultTimeout(ACTION_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  if (!configuredContexts.has(context)) {
    configuredContexts.add(context);
    context.on('page', observePageRequests);
    for (const existingPage of context.pages()) observePageRequests(existingPage);
  }
  observePageRequests(page);
}

export function observePageRequests(page: Page): void {
  if (networkStates.has(page)) return;
  const state = { pending: new Set<Request>(), failed: new Set<Request>(), scope: 0 };
  networkStates.set(page, state);
  const requests = new WeakMap<Request, { generation: number; scope: number; endpoint: string; identity: string }>();
  const superseded = new WeakSet<Request>();
  let generation = 0;
  const isDataRequest = (request: Request): boolean => ['xhr', 'fetch'].includes(request.resourceType());
  const isMainNavigation = (request: Request): boolean =>
    request.resourceType() === 'document' && request.isNavigationRequest() && request.frame() === page.mainFrame();
  const isCurrentRequest = (request: Request): boolean =>
    !superseded.has(request) && (requests.get(request)?.generation ?? generation) === generation;
  page.on('request', request => {
    if (isMainNavigation(request)) {
      generation += 1;
      state.pending.clear();
      state.failed.clear();
    }
    const url = new URL(request.url());
    const endpoint = JSON.stringify([request.method(), url.origin, url.pathname]);
    const identity = JSON.stringify([request.method(), request.url(), request.postData()]);
    if (isDataRequest(request)) {
      for (const previous of new Set([...state.pending, ...state.failed])) {
        const previousState = requests.get(previous);
        if (!previousState || !isDataRequest(previous)) continue;
        // フィルタ変更は同じ取得先の旧要求を、再試行は同一要求を置き換える。
        const replacedByFilter = previousState.scope < state.scope && previousState.endpoint === endpoint;
        const retried = previousState.identity === identity;
        if (replacedByFilter || retried) {
          superseded.add(previous);
          state.pending.delete(previous);
          state.failed.delete(previous);
        }
      }
      state.pending.add(request);
    }
    requests.set(request, { generation, scope: state.scope, endpoint, identity });
  });
  page.on('requestfinished', request => { state.pending.delete(request); });
  page.on('requestfailed', request => {
    state.pending.delete(request);
    if (isCurrentRequest(request) && (isDataRequest(request) || isMainNavigation(request))) {
      state.failed.add(request);
    }
  });
  page.on('response', response => {
    const request = response.request();
    if (isCurrentRequest(request) && response.status() >= 400
      && (isDataRequest(request) || isMainNavigation(request))) state.failed.add(request);
  });
}

export function beginPageRequestScope(page: Page): void {
  observePageRequests(page);
  networkStates.get(page)!.scope += 1;
}

export function assertPageRequestsSettled(page: Page): void {
  const state = networkStates.get(page);
  const origin = new URL(page.url()).origin;
  const sameOrigin = (request: Request): boolean => new URL(request.url()).origin === origin;
  if (!state || [...state.pending, ...state.failed].some(sameOrigin)) {
    throw new Error('申込状況の取得に失敗、または10秒以内に完了しませんでした。');
  }
}

export function getVisibleButton(page: Page, name: string | RegExp): Locator {
  const exact = typeof name === 'string';
  const visibleLabel = page.getByText(name, { exact }).filter({ visible: true });
  return page.getByRole('button', { name, exact })
    .or(page.locator('button:visible').filter({ has: visibleLabel }))
    .first();
}
