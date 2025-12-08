import dotenv from 'dotenv';

export function loadEnv(): void {
  dotenv.config();
  dotenv.config({ path: 'playwright/.env.local' });
}
