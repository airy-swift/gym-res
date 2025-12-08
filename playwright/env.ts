import dotenv from 'dotenv';

export function loadEnv(): void {
  dotenv.config();
  dotenv.config({ path: '.env.local' });
}
