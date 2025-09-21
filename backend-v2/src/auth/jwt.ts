/**
 * SafeSpot Sentinel Global V2 - JWT Authentication
 * Secure JWT implementation with refresh tokens and revocation
 */

import { config } from '../config/index.js';
import { logger, logSecurityEvent } from '../utils/logger.js';
import { setCache, getCache, deleteCache, hasCache } from '../cache/redis.js';
import { generateSecureToken } from '../security/encryption.js';
import { signJWT, verifyJWT } from './jwtAdapter.js';

export interface AppJWTPayload {
  sub: string; // User ID
  email: string;
  role: string;
  sessionId: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
  jti?: string; // Token ID for revocation
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

function parseTimeToSeconds(timeString: string): number {
  const match = timeString.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid time format: ${timeString}`);
  }
  const value = parseInt(match[1]!);
  const unit = match[2];
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: throw new Error(`Unknown time unit: ${unit}`);
  }
}

export async function createAccessToken(payload: Omit<AppJWTPayload, 'type' | 'iat' | 'exp' | 'jti'>): Promise<string> {
  const expiresIn = parseTimeToSeconds(config.security.jwt.accessExpiresIn);
  const tokenId = generateSecureToken(16);
  const fullPayload = { ...payload, type: 'access' as const, jti: tokenId };
  const jwt = await signJWT(fullPayload, config.security.jwt.secret, expiresIn, payload.sub);
  await setCache(`token:${tokenId}`, { type: 'access', userId: String(payload.sub), sessionId: String(payload.sessionId) }, { ttl: expiresIn, prefix: 'auth' });
  return jwt;
}

export async function createRefreshToken(payload: Omit<AppJWTPayload, 'type' | 'iat' | 'exp' | 'jti'>): Promise<string> {
  const expiresIn = parseTimeToSeconds(config.security.jwt.refreshExpiresIn);
  const tokenId = generateSecureToken(16);
  const fullPayload = { ...payload, type: 'refresh' as const, jti: tokenId };
  const jwt = await signJWT(fullPayload, config.security.jwt.refreshSecret, expiresIn, payload.sub);
  await setCache(`refresh:${tokenId}`, { type: 'refresh', userId: String(payload.sub), sessionId: String(payload.sessionId) }, { ttl: expiresIn, prefix: 'auth' });
  return jwt;
}

export async function createTokenPair(payload: Omit<AppJWTPayload, 'type' | 'iat' | 'exp' | 'jti'>): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken(payload),
    createRefreshToken(payload),
  ]);
  const expiresIn = parseTimeToSeconds(config.security.jwt.accessExpiresIn);
  return { accessToken, refreshToken, expiresIn, tokenType: 'Bearer' };
}

export async function verifyAccessToken(token: string): Promise<AppJWTPayload> {
  try {
    const pay = (await verifyJWT(token, config.security.jwt.secret)) as AppJWTPayload;
    if (pay.type !== 'access') throw new Error('Invalid token type');
    if (pay.jti && await hasCache(`revoked:${pay.jti}`, { prefix: 'auth' })) {
      throw new Error('Token revoked');
    }
    return pay;
  } catch (error) {
    logger.warn(`Access token verification failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Invalid or expired access token');
  }
}

export async function verifyRefreshToken(token: string): Promise<AppJWTPayload> {
  try {
    const pay = (await verifyJWT(token, config.security.jwt.refreshSecret)) as AppJWTPayload;
    if (pay.type !== 'refresh') throw new Error('Invalid token type');
    if (pay.jti && !await hasCache(`refresh:${pay.jti}`, { prefix: 'auth' })) {
      throw new Error('Refresh token not found or expired');
    }
    return pay;
  } catch (error) {
    logger.warn(`Refresh token verification failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error('Invalid or expired refresh token');
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  try {
    const refreshPayload = await verifyRefreshToken(refreshToken);
    const newTokenPair = await createTokenPair({ sub: refreshPayload.sub, email: refreshPayload.email, role: refreshPayload.role, sessionId: refreshPayload.sessionId });
    if (refreshPayload.jti) {
      await revokeToken(refreshPayload.jti, 'refresh');
    }
    logger.info(`Access token refreshed for user ${refreshPayload.sub}, session ${refreshPayload.sessionId}`);
    return newTokenPair;
  } catch (error) {
    logger.warn(`Token refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    logSecurityEvent({ type: 'suspicious_activity', severity: 'medium', source: 'jwt_refresh', metadata: { error: error instanceof Error ? error.message : String(error) } });
    throw new Error('Token refresh failed');
  }
}

export async function revokeToken(tokenId: string, type: 'access' | 'refresh' = 'access'): Promise<void> {
  try {
    await setCache(`revoked:${tokenId}`, { revokedAt: new Date().toISOString(), type }, { ttl: parseTimeToSeconds(type === 'access' ? config.security.jwt.accessExpiresIn : config.security.jwt.refreshExpiresIn), prefix: 'auth' });
    await deleteCache(`${type}:${tokenId}`, { prefix: 'auth' });
    logger.info(`Token revoked: ${tokenId} (${type})`);
  } catch (error) {
    logger.error(`Token revocation failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function revokeUserSession(userId: string, sessionId: string): Promise<void> {
  try {
    await setCache(`revoked_session:${sessionId}`, { userId, revokedAt: new Date().toISOString() }, { ttl: parseTimeToSeconds(config.security.jwt.refreshExpiresIn), prefix: 'auth' });
    logger.info(`User session revoked: ${userId}, session ${sessionId}`);
  } catch (error) {
    logger.error(`Session revocation failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  try {
    const revocationTime = Date.now();
    await setCache(`user_revoked:${userId}`, { revokedAt: new Date().toISOString(), timestamp: revocationTime }, { ttl: parseTimeToSeconds(config.security.jwt.refreshExpiresIn), prefix: 'auth' });
    logger.info(`All user tokens revoked: ${userId}`);
  } catch (error) {
    logger.error(`User token revocation failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export async function isUserRevoked(userId: string, tokenIssuedAt: number): Promise<boolean> {
  try {
    const revocationData = await getCache<{ timestamp: number }>(`user_revoked:${userId}`, { prefix: 'auth' });
    if (!revocationData) return false;
    return tokenIssuedAt < revocationData.timestamp;
  } catch (error) {
    logger.error(`User revocation check failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export function decodeToken(token: string): AppJWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadBase64 = parts[1];
    const json = Buffer.from(payloadBase64 || '', 'base64').toString('utf-8');
    const payload = JSON.parse(json || '{}');
    return payload as AppJWTPayload;
  } catch {
    return null;
  }
}