/**
 * Loads .env for local development. Node 22 has process.loadEnvFile, so no dependency.
 * Absent .env (CI, or a shell that exports the variables) is not an error.
 */
import { existsSync } from 'node:fs';

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync('.env')) {
      (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile('.env');
    }
  } catch {
    // Never fail startup on this: the variables may already be in the environment.
  }
}
