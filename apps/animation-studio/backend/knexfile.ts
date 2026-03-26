// knexfile.ts
// DATABASE CONFIGURATION — all values read from validated env module.
// knexfile runs at process start (before any route handlers) so we must
// ensure env validation runs synchronously before the Knex client is created.
// The app env module (src/config/env.ts) does this via synchronous safeParse
// + require('@arkiol/shared').validateSharedEnv() at import time.
//
// knexfile is imported by both the application server AND by the `knex` CLI
// for running migrations. In both cases dotenv/config must load the .env file
// before the env module can validate — so we load it first here.
import type { Knex } from 'knex';
import 'dotenv/config';

// Import validated config — this triggers env validation (fail-fast, synchronous).
// All DATABASE_* values come from the validated object, never raw process.env.
import { config as appConfig } from './src/config/env';

const knexConfig: Knex.Config = {
  client: 'pg',
  // config.DATABASE_URL is validated as z.string().min(1) — guaranteed non-empty.
  connection: appConfig.DATABASE_URL,
  pool: {
    // config.DATABASE_POOL_MIN/MAX are validated as z.coerce.number() with defaults.
    min: appConfig.DATABASE_POOL_MIN,
    max: appConfig.DATABASE_POOL_MAX,
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: './src/migrations',
    extension: 'ts',
    loadExtensions: ['.ts'],
  },
  seeds: {
    directory: './src/seeds',
  },
};

module.exports = knexConfig;
export default knexConfig;
