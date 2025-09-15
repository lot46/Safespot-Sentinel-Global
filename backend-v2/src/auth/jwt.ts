/**
 * SafeSpot Sentinel Global V2 - JWT Authentication
 * Secure JWT implementation with refresh tokens and revocation
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config/index.js';
import { logger, logSecurityEvent } from '../utils/logger.js';
import { setCache, getCache, deleteCache, hasCache } from '../cache/redis.js';
import { generateSecureToken } from '../security/encryption.js';

const jwtSecret = new TextEncoder().encode(config.security.jwt.secret);
const refreshSecret = new TextEncoder().encode(config.security.jwt.refreshSecret);

export interface JWTPayload {
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

/**
 * Parse time string to seconds (e.g., "15m" -> 900)
 */
function parseTimeToSeconds(timeString: string): number {
  const match = timeString.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid time format: ${timeString}`);
  }
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: throw new Error(`Unknown time unit: ${unit}`);
  }
}

/**
 * Create JWT access token
 */
export async function createAccessToken(payload: Omit<JWTPayload, 'type' | 'iat' | 'exp' | 'jti'>): Promise<string> {
  const expiresIn = parseTimeToSeconds(config.security.jwt.accessExpiresIn);
  const tokenId = generateSecureToken(16);
  
  const jwt = await new SignJWT({
    ...payload,
    type: 'access',
    jti: tokenId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
    .setSubject(payload.sub)
    .sign(jwtSecret);

  // Store token ID for potential revocation
  await setCache(`token:${tokenId}`, { 
    type: 'access', 
    userId: payload.sub, 
    sessionId: payload.sessionId 
  }, { 
    ttl: expiresIn,
    prefix: 'auth'
  });

  return jwt;
}

/**
 * Create JWT refresh token
 */
export async function createRefreshToken(payload: Omit<JWTPayload, 'type' | 'iat' | 'exp' | 'jti'>): Promise<string> {
  const expiresIn = parseTimeToSeconds(config.security.jwt.refreshExpiresIn);
  const tokenId = generateSecureToken(16);
  
  const jwt = await new SignJWT({
    ...payload,
    type: 'refresh',
    jti: tokenId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
    .setSubject(payload.sub)
    .sign(refreshSecret);

  // Store refresh token for rotation and revocation
  await setCache(`refresh:${tokenId}`, { 
    type: 'refresh', 
    userId: payload.sub, 
    sessionId: payload.sessionId 
  }, { 
    ttl: expiresIn,
    prefix: 'auth'
  });

  return jwt;
}

/**
 * Create token pair (access + refresh)
 */
export async function createTokenPair(payload: Omit<JWTPayload, 'type' | 'iat' | 'exp' | 'jti'>): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    createAccessToken(payload),
    createRefreshToken(payload),
  ]);

  const expiresIn = parseTimeToSeconds(config.security.jwt.accessExpiresIn);

  return {
    accessToken,
    refreshToken,
    expiresIn,
    tokenType: 'Bearer',
  };
}

/**
 * Verify JWT access token
 */
export async function verifyAccessToken(token: string): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret);
    
    const jwtPayload = payload as JWTPayload;
    
    // Check if token type is correct
    if (jwtPayload.type !== 'access') {
      throw new Error('Invalid token type');
    }

    // Check if token is revoked
    if (jwtPayload.jti && await hasCache(`revoked:${jwtPayload.jti}`, { prefix: 'auth' })) {
      throw new Error('Token revoked');
    }

    return jwtPayload;
    
  } catch (error) {
    logger.warn('Access token verification failed:', error);
    throw new Error('Invalid or expired access token');
  }
}

/**
 * Verify JWT refresh token
 */
export async function verifyRefreshToken(token: string): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, refreshSecret);
    
    const jwtPayload = payload as JWTPayload;
    
    // Check if token type is correct
    if (jwtPayload.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    // Check if refresh token exists in cache (not revoked)
    if (jwtPayload.jti && !await hasCache(`refresh:${jwtPayload.jti}`, { prefix: 'auth' })) {
      throw new Error('Refresh token not found or expired');
    }

    return jwtPayload;
    
  } catch (error) {
    logger.warn('Refresh token verification failed:', error);
    throw new Error('Invalid or expired refresh token');
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  try {
    const refreshPayload = await verifyRefreshToken(refreshToken);
    
    // Create new token pair
    const newTokenPair = await createTokenPair({
      sub: refreshPayload.sub,
      email: refreshPayload.email,
      role: refreshPayload.role,
      sessionId: refreshPayload.sessionId,
    });

    // Revoke old refresh token (token rotation)
    if (refreshPayload.jti) {
      await revokeToken(refreshPayload.jti, 'refresh');
    }

    logger.info('Access token refreshed', { 
      userId: refreshPayload.sub,
      sessionId: refreshPayload.sessionId 
    });

    return newTokenPair;
    
  } catch (error) {
    logger.warn('Token refresh failed:', error);
    
    // Log security event for failed refresh attempts
    logSecurityEvent({
      type: 'suspicious_activity',
      severity: 'medium',
      source: 'jwt_refresh',
      metadata: { error: error.message }
    });
    
    throw new Error('Token refresh failed');
  }
}

/**
 * Revoke a specific token
 */
export async function revokeToken(tokenId: string, type: 'access' | 'refresh' = 'access'): Promise<void> {
  try {
    // Add to revocation list
    await setCache(`revoked:${tokenId}`, { 
      revokedAt: new Date().toISOString(),
      type 
    }, { 
      ttl: parseTimeToSeconds(type === 'access' ? config.security.jwt.accessExpiresIn : config.security.jwt.refreshExpiresIn),
      prefix: 'auth'
    });

    // Remove from active tokens
    await deleteCache(`${type}:${tokenId}`, { prefix: 'auth' });

    logger.info('Token revoked', { tokenId, type });
    
  } catch (error) {
    logger.error('Token revocation failed:', error);
    throw error;
  }
}

/**
 * Revoke all tokens for a user session
 */
export async function revokeUserSession(userId: string, sessionId: string): Promise<void> {
  try {
    // This would require maintaining a user-token mapping
    // For now, we'll add the session to a revoked sessions list
    await setCache(`revoked_session:${sessionId}`, { 
      userId,
      revokedAt: new Date().toISOString() 
    }, { 
      ttl: parseTimeToSeconds(config.security.jwt.refreshExpiresIn),
      prefix: 'auth'
    });

    logger.info('User session revoked', { userId, sessionId });
    
  } catch (error) {
    logger.error('Session revocation failed:', error);
    throw error;
  }
}

/**
 * Revoke all tokens for a user (across all sessions)
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  try {
    // Add user to global revocation list with timestamp
    const revocationTime = Date.now();
    await setCache(`user_revoked:${userId}`, { 
      revokedAt: new Date().toISOString(),
      timestamp: revocationTime 
    }, { 
      ttl: parseTimeToSeconds(config.security.jwt.refreshExpiresIn),
      prefix: 'auth'
    });

    logger.info('All user tokens revoked', { userId });
    
  } catch (error) {
    logger.error('User token revocation failed:', error);
    throw error;
  }
}

/**
 * Check if user has been globally revoked
 */
export async function isUserRevoked(userId: string, tokenIssuedAt: number): Promise<boolean> {
  try {
    const revocationData = await getCache<{ timestamp: number }>(`user_revoked:${userId}`, { prefix: 'auth' });
    
    if (!revocationData) {
      return false;
    }

    // Check if token was issued before revocation
    return tokenIssuedAt < revocationData.timestamp;
    
  } catch (error) {
    logger.error('User revocation check failed:', error);
    return false;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader?: string): string | null {
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');
  
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

/**
 * Decode JWT without verification (for inspecting payload)
 */
export function decodeToken(token: string): JWTPayload | null {
  try {
    const [, payloadBase64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
    return payload as JWTPayload;
  } catch {
    return null;
  }
}