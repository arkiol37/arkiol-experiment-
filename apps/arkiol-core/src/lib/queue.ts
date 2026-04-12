// src/lib/queue.ts
// Safe queue — only connects to Redis when REDIS_HOST is configured.
// When Redis is unavailable, all queue operations return safe stubs.
import { detectCapabilities } from '@arkiol/shared';

function getRedisConnection() {
  const env = process.env;
  return {
    host:     env.REDIS_HOST ?? 'localhost',
    port:     parseInt(env.REDIS_PORT ?? '6379', 10),
    password: env.REDIS_PASSWORD,
    tls:      env.REDIS_TLS === 'true' ? {} as any : undefined,
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  };
}

// Stub queue for when Redis is not configured
const stubQueue: any = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'add') return () => Promise.resolve({ id: 'stub-job' });
    if (prop === 'getJob') return () => Promise.resolve(null);
    if (prop === 'getJobs') return () => Promise.resolve([]);
    if (prop === 'getJobCounts') return () => Promise.resolve({ waiting: 0, failed: 0, completed: 0, active: 0, delayed: 0 });
    if (prop === 'getWaitingCount') return () => Promise.resolve(0);
    if (prop === 'getActiveCount') return () => Promise.resolve(0);
    if (prop === 'getFailedCount') return () => Promise.resolve(0);
    if (prop === 'getCompletedCount') return () => Promise.resolve(0);
    if (prop === 'getDelayedCount') return () => Promise.resolve(0);
    if (prop === 'drain') return () => Promise.resolve();
    if (prop === 'close') return () => Promise.resolve();
    if (prop === 'obliterate') return () => Promise.resolve();
    if (prop === 'on') return () => stubQueue;
    if (prop === 'removeAllListeners') return () => stubQueue;
    return () => Promise.resolve(null);
  },
});

// Queue factory - creates real or stub depending on Redis availability
function makeQueue(name: string, opts: any = {}) {
  if (!detectCapabilities().queue) return stubQueue;
  try {
    const { Queue } = require('bullmq');
    return new Queue(name, { connection: getRedisConnection(), ...opts });
  } catch {
    return stubQueue;
  }
}

function makeQueueEvents(name: string) {
  if (!detectCapabilities().queue) return stubQueue;
  try {
    const { QueueEvents } = require('bullmq');
    return new QueueEvents(name, { connection: getRedisConnection() });
  } catch {
    return stubQueue;
  }
}

export const generationQueue = makeQueue('arkiol:generation', {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 200, age: 86400 },
    removeOnFail: { count: 100, age: 86400 * 7 },
  },
});

export const webhookQueue = makeQueue('arkiol:webhooks', {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 200 },
  },
});

export const renderQueue = makeQueue('arkiol:render', {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

export const exportQueue = makeQueue('arkiol:exports', {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 200, age: 86400 * 3 },
    removeOnFail: false,
  },
});

export const dlqQueue = makeQueue('arkiol:dlq', {
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
  },
});

export const generationEvents = makeQueueEvents('arkiol:generation');

export async function getQueueJobStatus(jobId: string) {
  if (!detectCapabilities().queue) return null;
  const job = await generationQueue.getJob(jobId);
  if (!job) return null;
  const state = await job.getState();
  return {
    id:         job.id,
    state,
    progress:   typeof job.progress === 'number' ? job.progress : 0,
    result:     state === 'completed' ? job.returnvalue : null,
    failReason: state === 'failed' ? job.failedReason : null,
    attempts:   job.attemptsMade,
    createdAt:  new Date(job.timestamp).toISOString(),
    startedAt:  job.processedOn ? new Date(job.processedOn).toISOString() : null,
    finishedAt: job.finishedOn  ? new Date(job.finishedOn).toISOString()  : null,
  };
}
