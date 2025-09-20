/**
 * SafeSpot Sentinel Global V2 - Redis Cache & Session Management
 * High-performance caching with security features
 */

import Redis from 'ioredis';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

let redis: Redis;
// In-memory fallback for tests or when Redis is not initialized
const memoryStore = new Map<string, { value: string; expireAt?: number }>();
function memSet(key: string, value: string, ttlSeconds?: number) {
  const expireAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined;
  memoryStore.set(key, { value, expireAt });
}
function memGet(key: string): string | null {
  const item = memoryStore.get(key);
  if (!item) return null;
  if (item.expireAt && item.expireAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return item.value;
}
function memDel(key: string) {
  memoryStore.delete(key);
}
function memExists(key: string): boolean {
  const item = memoryStore.get(key);
  if (!item) return false;
  if (item.expireAt && item.expireAt <= Date.now()) {
    memoryStore.delete(key);
    return false;
  }
  return true;
}

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string;
}

/**
 * Initialize Redis connection
 */
export async function initializeRedis(): Promise<void> {
  try {
    logger.info('🗄️  Connecting to Redis...');
    
    redis = new Redis(config.redis.url, {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      // Connection pooling
      family: 4,
      // Security
      connectTimeout: 10000,
      commandTimeout: 5000,
    });

    // Event handlers
    redis.on('connect', () => {
      logger.info('✅ Redis connected');
    });

    redis.on('error', (error) => {
      logger.error('❌ Redis error:', error);
    });

    redis.on('reconnecting', () => {
      logger.warn('🔄 Redis reconnecting...');
    });

    // Test connection
    await redis.connect();
    await redis.ping();
    
    logger.info('✅ Redis initialized successfully');
    
  } catch (error) {
    logger.error('❌ Failed to initialize Redis:', error);
    throw error;
  }
}

/**
 * Get Redis client instance
 */
export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Redis not initialized. Call initializeRedis() first.');
  }
  return redis;
}

/**
 * Set cache value with automatic serialization
 */
export async function setCache<T>(
  key: string, 
  value: T, 
  options: CacheOptions = {}
): Promise<void> {
  const { ttl = 3600, prefix = 'ssg' } = options;
  const fullKey = `${prefix}:${key}`;
  
  try {
    const serialized = JSON.stringify(value);

    if (redis) {
      if (ttl > 0) {
        await redis.setex(fullKey, ttl, serialized);
      } else {
        await redis.set(fullKey, serialized);
      }
    } else {
      memSet(fullKey, serialized, ttl);
    }
    
    logger.debug(`Cache set: ${fullKey} (TTL: ${ttl}s)`);
  } catch (error) {
    logger.error('Cache set error:', error);
    throw error;
  }
}

/**
 * Get cache value with automatic deserialization
 */
export async function getCache<T>(
  key: string, 
  options: Pick<CacheOptions, 'prefix'> = {}
): Promise<T | null> {
  const { prefix = 'ssg' } = options;
  const fullKey = `${prefix}:${key}`;
  
  try {
    const cached = await redis.get(fullKey);
    
    if (cached === null) {
      return null;
    }
    
    const parsed = JSON.parse(cached) as T;
    logger.debug(`Cache hit: ${fullKey}`);
    return parsed;
    
  } catch (error) {
    logger.error('Cache get error:', error);
    return null;
  }
}

/**
 * Delete cache key
 */
export async function deleteCache(
  key: string, 
  options: Pick<CacheOptions, 'prefix'> = {}
): Promise<void> {
  const { prefix = 'ssg' } = options;
  const fullKey = `${prefix}:${key}`;
  
  try {
    await redis.del(fullKey);
    logger.debug(`Cache deleted: ${fullKey}`);
  } catch (error) {
    logger.error('Cache delete error:', error);
  }
}

/**
 * Check if cache key exists
 */
export async function hasCache(
  key: string, 
  options: Pick<CacheOptions, 'prefix'> = {}
): Promise<boolean> {
  const { prefix = 'ssg' } = options;
  const fullKey = `${prefix}:${key}`;
  
  try {
    const exists = await redis.exists(fullKey);
    return exists === 1;
  } catch (error) {
    logger.error('Cache exists error:', error);
    return false;
  }
}

/**
 * Set cache with expiration timestamp
 */
export async function setCacheUntil<T>(
  key: string, 
  value: T, 
  expiresAt: Date,
  options: Pick<CacheOptions, 'prefix'> = {}
): Promise<void> {
  const ttl = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  await setCache(key, value, { ...options, ttl });
}

/**
 * Increment counter in Redis
 */
export async function incrementCounter(
  key: string,
  increment: number = 1,
  options: CacheOptions = {}
): Promise<number> {
  const { ttl = 3600, prefix = 'ssg' } = options;
  const fullKey = `${prefix}:${key}`;
  
  try {
    const pipeline = redis.pipeline();
    pipeline.incrby(fullKey, increment);
    
    if (ttl > 0) {
      pipeline.expire(fullKey, ttl);
    }
    
    const results = await pipeline.exec();
    return results?.[0]?.[1] as number || 0;
    
  } catch (error) {
    logger.error('Counter increment error:', error);
    throw error;
  }
}

/**
 * Rate limiting using sliding window
 */
export async function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number,
  prefix: string = 'ratelimit'
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const key = `${prefix}:${identifier}`;
  const now = Date.now();
  const window = Math.floor(now / windowMs);
  const windowKey = `${key}:${window}`;
  
  try {
    const pipeline = redis.pipeline();
    pipeline.incr(windowKey);
    pipeline.expire(windowKey, Math.ceil(windowMs / 1000));
    
    const results = await pipeline.exec();
    const count = results?.[0]?.[1] as number || 0;
    
    const allowed = count <= maxRequests;
    const remaining = Math.max(0, maxRequests - count);
    const resetTime = (window + 1) * windowMs;
    
    return { allowed, remaining, resetTime };
    
  } catch (error) {
    logger.error('Rate limit check error:', error);
    // Fail open for availability
    return { allowed: true, remaining: maxRequests, resetTime: now + windowMs };
  }
}

/**
 * Store session data
 */
export async function setSession(
  sessionId: string,
  data: any,
  ttlSeconds: number = 86400 // 24 hours
): Promise<void> {
  await setCache(`session:${sessionId}`, data, { 
    ttl: ttlSeconds, 
    prefix: 'auth' 
  });
}

/**
 * Get session data
 */
export async function getSession<T = any>(sessionId: string): Promise<T | null> {
  return getCache<T>(`session:${sessionId}`, { prefix: 'auth' });
}

/**
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await deleteCache(`session:${sessionId}`, { prefix: 'auth' });
}

 * Delete session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await deleteCache(`session:${sessionId}`, { prefix: 'auth' });
}

/**
 * Store WebSocket connection metadata
 */
export async function setWebSocketConnection(
  connectionId: string,
  metadata: {
    userId?: string;
    channels: string[];
    connectedAt: number;
    ipAddress?: string;
  }
): Promise<void> {
  await setCache(`ws:${connectionId}`, metadata, {
    ttl: 3600, // Connection timeout
    prefix: 'websocket'
  });
}

/**
 * Get WebSocket connection metadata
 */
export async function getWebSocketConnection(
  connectionId: string
): Promise<any | null> {
  return getCache(`ws:${connectionId}`, { prefix: 'websocket' });
}

/**
 * Remove WebSocket connection
 */
export async function removeWebSocketConnection(connectionId: string): Promise<void> {
  await deleteCache(`ws:${connectionId}`, { prefix: 'websocket' });
}

/**
 * Health check for Redis
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch (error) {
    logger.error('Redis health check failed:', error);
    return false;
  }
}

/**
 * Get Redis info and stats
 */
export async function getRedisStats(): Promise<{
  connected: boolean;
  memory: string;
  keyspace: Record<string, any>;
  connections: number;
}> {
  try {
    const info = await redis.info();
    const lines = info.split('\r\n');
    
    const memory = lines.find(line => line.startsWith('used_memory_human:'))?.split(':')[1] || 'unknown';
    const connections = parseInt(lines.find(line => line.startsWith('connected_clients:'))?.split(':')[1] || '0');
    
    const keyspaceLines = lines.filter(line => line.startsWith('db'));
    const keyspace: Record<string, any> = {};
    
    for (const line of keyspaceLines) {
      const [db, stats] = line.split(':');
      keyspace[db] = stats;
    }
    
    return {
      connected: true,
      memory,
      keyspace,
      connections
    };
    
  } catch (error) {
    logger.error('Failed to get Redis stats:', error);
    return {
      connected: false,
      memory: 'unknown',
      keyspace: {},
      connections: 0
    };
  }
}

/**
 * Disconnect Redis
 */
export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    logger.info('🗄️  Redis disconnected');
  }
}