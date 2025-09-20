/**
 * SafeSpot Sentinel Global V2 - Authentication Middleware
 * JWT-based authentication with role-based access control
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, extractTokenFromHeader, JWTPayload } from '../auth/jwt.js';
import { logger, logSecurityEvent } from '../utils/logger.js';
import { getPrisma } from '../database/index.js';

const prisma = getPrisma();

// Extend FastifyRequest to include user information
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      role: string;
      sessionId: string;
      isPremium: boolean;
    };
    requireAuth?: boolean;
    requiredRole?: string;
    requiredPermissions?: string[];
  }
}

/**
 * Authentication middleware - verifies JWT token
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      // If auth is not required for this route, continue
      if (!request.requireAuth) {
        return;
      }
      
      throw new Error('Authorization token required');
    }

    // Verify JWT token
    const payload = await verifyAccessToken(token);
    
    // Get user details from database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        isBanned: true,
        isPremium: true,
        premiumUntil: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      throw new Error('User not found');
    }

    if (!user.isActive || user.isBanned) {
      logSecurityEvent({
        type: 'unauthorized_access',
        severity: 'medium',
        source: request.ip,
        userId: user.id,
        metadata: { reason: user.isBanned ? 'banned' : 'inactive' },
      });
      throw new Error('Account is inactive or banned');
    }

    // Check premium status
    const isPremium = user.isPremium && 
      (user.premiumUntil ? user.premiumUntil > new Date() : true);

    // Set user context
    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId: payload.sessionId,
      isPremium,
    };

    // Update last activity (async, don't await)
    prisma.user.update({
      where: { id: user.id },
      data: { 
        lastLoginAt: new Date(),
        lastLoginIP: request.ip,
      },
    }).catch(error => {
      logger.warn('Failed to update user last activity:', error);
    });

  } catch (error: any) {
    if (request.requireAuth) {
      // Log failed authentication attempt
      logSecurityEvent({
        type: 'failed_login',
        severity: 'low',
        source: request.ip,
        metadata: { 
          error: error.message,
          userAgent: request.headers['user-agent'],
          route: request.url,
        },
      });

      reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }
  }
}

/**
 * Role-based authorization middleware
 */
export async function roleMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.requiredRole || !request.user) {
    return;
  }

  const userRole = request.user.role;
  const requiredRole = request.requiredRole;

  // Role hierarchy: ADMIN > MODERATOR > USER
  const roleHierarchy = {
    USER: 0,
    MODERATOR: 1,
    ADMIN: 2,
  };

  const userLevel = roleHierarchy[userRole as keyof typeof roleHierarchy] ?? -1;
  const requiredLevel = roleHierarchy[requiredRole as keyof typeof roleHierarchy] ?? 999;

  if (userLevel < requiredLevel) {
    logSecurityEvent({
      type: 'unauthorized_access',
      severity: 'medium',
      source: request.ip,
      userId: request.user.id,
      metadata: {
        userRole,
        requiredRole,
        route: request.url,
      },
    });

    reply.code(403).send({
      error: {
        code: 'FORBIDDEN',
        message: 'Insufficient permissions',
      },
    });
  }
}

/**
 * Premium subscription middleware
 */
export async function premiumMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    return;
  }

  if (!request.user.isPremium) {
    reply.code(402).send({
      error: {
        code: 'PREMIUM_REQUIRED',
        message: 'Premium subscription required',
        upgradeUrl: '/api/payments/checkout',
      },
    });
  }
}

/**
 * Create authentication decorator
 */
export function createAuthDecorator() {
  return {
    /**
     * Require authentication for route
     */
    requireAuth: (request: FastifyRequest) => {
      request.requireAuth = true;
    },

    /**
     * Require specific role for route
     */
    requireRole: (role: string) => (request: FastifyRequest) => {
      request.requireAuth = true;
      request.requiredRole = role;
    },

    /**
     * Require premium subscription for route
     */
    requirePremium: (request: FastifyRequest) => {
      request.requireAuth = true;
      // Premium check will be done in premiumMiddleware
    },

    /**
     * Optional authentication (user context if token provided)
     */
    optionalAuth: (request: FastifyRequest) => {
      request.requireAuth = false;
    },
  };
}

/**
 * IP-based rate limiting middleware
 */
export async function ipRateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  maxRequests: number = 100,
  windowMs: number = 900000 // 15 minutes
): Promise<void> {
  const { checkRateLimit } = await import('../cache/redis.js');
  const ip = request.ip;

  try {
    const { allowed, remaining, resetTime } = await checkRateLimit(ip, maxRequests, windowMs, 'ip_rate_limit');

    if (!allowed) {
      logSecurityEvent({
        type: 'rate_limit_exceeded',
        severity: 'medium',
        source: ip,
        metadata: {
          limit: maxRequests,
          window: windowMs,
        },
      });

      reply.code(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests from this IP',
          retryAfter: Math.ceil((resetTime - Date.now()) / 1000),
        },
      });
      return;
    }

    // Add rate limit headers
    reply.header('X-RateLimit-Limit', maxRequests);
    reply.header('X-RateLimit-Remaining', Math.max(0, remaining));
    reply.header('X-RateLimit-Reset', new Date(resetTime).toISOString());

  } catch (error) {
    logger.error('Rate limiting error:', error);
    // Fail open - continue processing request
  }
}

/**
 * CSRF protection middleware
 */
export async function csrfMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip CSRF for GET, HEAD, OPTIONS requests
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return;
  }

  // Skip CSRF for API requests with proper Authorization header
  if (request.headers.authorization?.startsWith('Bearer ')) {
    return;
  }

  // Double-submit cookie: token must match header and cookie
  const csrfToken = request.headers['x-csrf-token'] as string;
  const csrfCookie = (request.cookies && (request.cookies['ssg_csrf'] as string)) || '';

  if (!csrfToken || !csrfCookie || csrfToken !== csrfCookie) {
    logSecurityEvent({
      type: 'suspicious_activity',
      severity: 'high',
      source: request.ip,
      userId: request.user?.id,
      metadata: {
        reason: 'csrf_token_mismatch',
        route: request.url,
        userAgent: request.headers['user-agent'],
      },
    });

    reply.code(403).send({
      error: {
        code: 'CSRF_TOKEN_REQUIRED',
        message: 'CSRF token validation failed',
      },
    });
  }
}