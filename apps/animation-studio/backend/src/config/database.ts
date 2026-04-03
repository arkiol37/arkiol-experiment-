import knex from 'knex';
import { config } from './env';
import { logger } from './logger';

export const db = knex({
  client: 'postgresql',
  connection: config.DATABASE_URL,
  pool: {
    min: config.DATABASE_POOL_MIN,
    max: config.DATABASE_POOL_MAX,
    afterCreate: (conn: any, done: Function) => {
      conn.query('SET timezone="UTC";', (err: Error) => done(err, conn));
    },
  },
  acquireConnectionTimeout: 10000,
  debug: config.NODE_ENV === 'development',
  log: {
    warn(msg: string) { logger.warn(`[Knex] ${msg}`); },
    error(msg: string) { logger.error(`[Knex] ${msg}`); },
    deprecate(msg: string) { logger.warn(`[Knex deprecated] ${msg}`); },
    debug(msg: string) { if (config.NODE_ENV === 'development') logger.debug(`[Knex] ${msg}`); },
  },
});
