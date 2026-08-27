import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { config } from './config.ts';
import { logger } from './logger.ts';

export const redisState: {
  client: RedisClientType | null;
  subClient: RedisClientType | null;
  ready: boolean;
} = {
  client: null,
  subClient: null,
  ready: false,
};

export async function initRedis(): Promise<void> {
  if (!config.redisUrl) {
    logger.warn('Redis not configured, running in single-instance mode');
    return;
  }

  try {
    redisState.client = createClient({ url: config.redisUrl }) as RedisClientType;
    redisState.subClient = redisState.client.duplicate();

    redisState.client.on('error', (err) =>
      logger.error('Redis Client Error', { error: err.message }),
    );
    redisState.subClient.on('error', (err) =>
      logger.error('Redis Sub Client Error', { error: err.message }),
    );

    await Promise.all([redisState.client.connect(), redisState.subClient.connect()]);
    redisState.ready = true;
    logger.info('Redis connected successfully');
  } catch (err: any) {
    logger.error('Failed to connect to Redis', { error: err.message });
    redisState.ready = false;
  }
}
