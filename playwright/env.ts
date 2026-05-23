import dotenv from 'dotenv';
import path from 'node:path';

const cwd = process.cwd();
const projectRoot = path.basename(cwd) === 'playwright' ? path.resolve(cwd, '..') : cwd;
const playwrightDir = path.join(projectRoot, 'playwright');

export function loadEnv(): void {
  const envDirs = Array.from(new Set([process.cwd(), playwrightDir, projectRoot]));
  for (const dir of envDirs) {
    dotenv.config({ path: path.join(dir, '.env'), quiet: true });
    dotenv.config({ path: path.join(dir, '.env.local'), quiet: true });
  }
}
