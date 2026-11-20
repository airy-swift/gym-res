import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function buildServiceEnvironment(payload, mode) {
  if (mode !== 'reservation' && mode !== 'hit') {
    throw new Error('Invalid export mode');
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Expected a JSON object');
  }

  const environment = {};
  const fields = [['userId', 'SERVICE_USER'], ['password', 'SERVICE_PASS']];
  if (mode === 'reservation') {
    fields.push(['groupId', 'PLAYWRIGHT_GROUP_ID']);
  }

  for (const [field, name] of fields) {
    const value = payload[field];
    if (typeof value !== 'string' || value.length === 0 || /[\r\n\0]/.test(value)) {
      throw new Error(`Invalid ${field}`);
    }
    environment[name] = value;
  }

  if (mode === 'reservation') {
    if (payload.groupId.includes('/') || payload.groupId === '.' || payload.groupId === '..') {
      throw new Error('Invalid groupId');
    }
    if (!Number.isSafeInteger(payload.entryCount) || payload.entryCount < 1) {
      throw new Error('Invalid entryCount');
    }
    environment.ENTRY_COUNT = String(payload.entryCount);
  }

  return environment;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.GITHUB_ENV) {
      throw new Error('Missing environment file');
    }
    // 全項目を検証してから、ログや環境ファイルへ値を出力する。
    const environment = buildServiceEnvironment(JSON.parse(readFileSync(0, 'utf8')), process.argv[2]);
    for (const name of ['SERVICE_USER', 'SERVICE_PASS']) {
      console.log(`::add-mask::${environment[name].replaceAll('%', '%25')}`);
    }
    appendFileSync(process.env.GITHUB_ENV, Object.entries(environment).map(([name, value]) => `${name}=${value}\n`).join(''));
  } catch {
    // JSON解析エラーなどに認証情報が含まれ得るため、例外の内容は出力しない。
    console.error('Service data was invalid or could not be exported.');
    process.exitCode = 1;
  }
}
