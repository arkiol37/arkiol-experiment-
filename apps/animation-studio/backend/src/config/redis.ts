import Redis from 'ioredis';
import { config } from './env';
import { logger } from './logger';

const createRedisClient = () => {
  const client = new Redis(config.REDIS_URL, {
    tls: config.REDIS_TLS ? {} : undefined,
    retryStrategy: (times) => {
      if (times > 10) return null;
      return Math.min(times * 100, 3000);
    },
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  client.on('connect', () => logger.info('[Redis] Connected'));
  client.on('error', (err) => logger.error('[Redis] Error:', err));
  client.on('close', () => logger.warn('[Redis] Connection closed'));

  return client;
};

// Main client
export const redis = createRedisClient();

// Subscriber client (for pub/sub)
export const redisSub = createRedisClient();

// Bull queue client factory
export const createBullRedis = () => createRedisClient();
