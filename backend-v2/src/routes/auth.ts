/**
 * SafeSpot Sentinel Global V2 - Authentication Routes
 * JWT-based auth with 2FA, OAuth2/OIDC, CSRF, and security features
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger, logAuditEvent, logSecurityEvent } from '../utils/logger.js';
import { hashPassword, verifyPassword, generateSecureToken, encrypt, decrypt, normalizePhone, hashForSearch } from '../security/encryption.js';
import { createTokenPair, refreshAccessToken, revokeUserSession } from '../auth/jwt.js';
import { 
  generate2FASetup, 
  verify2FASetup, 
  verify2FA, 
  disable2FA,
  get2FAStatus,
  regenerateBackupCodes 
} from '../auth/2fa.js';
import { sendWelcomeEmail } from '../integrations/email.js';

const prisma = getPrisma();

// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().optional(),
  gdprConsent: z.boolean().refine(val => val === true, {
    message: 'GDPR consent is required'
  }),
  marketingConsent: z.boolean().default(false),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  twoFACode: z.string().optional(),
  rememberMe: z.boolean().default(false),
});

const refreshSchema = z.object({
  refreshToken: z.string().optional(),
});

const setup2FASchema = z.object({
  token: z.string().length(6),
});

const verify2FASchema = z.object({
  token: z.string(),
});

export default async function authRoutes(app: FastifyInstance) {
  // Helper: set refresh token cookie (HttpOnly)
  function setRefreshCookie(reply: any, token: string) {
    reply.setCookie('ssg_refresh', token, {
      httpOnly: true,
      secure: app.config.app.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });
  }

  // Helper: set CSRF cookie
  function setCSRFCookie(reply: any, token: string) {
    reply.setCookie('ssg_csrf', token, {
      httpOnly: false,
      secure: app.config.app.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    });
  }

  /**
   * CSRF token endpoint (double-submit cookie)
   */
  app.get('/csrf', {
    schema: {
      tags: ['Auth'],
      summary: 'Get CSRF token',
    },
  }, async (request, reply) => {
    const csrfToken = generateSecureToken(16);
    setCSRFCookie(reply, csrfToken);
    reply.send({ csrfToken });
  });

  /**
   * Register new user
   */
  app.post('/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register new user account',
    },
    preHandler: async (req, reply) => {
      // Per-route rate limit: 10 requests/hour per IP
      const { ipRateLimitMiddleware } = await import('../middleware/auth.js');
      await ipRateLimitMiddleware(req, reply, 10, 3600000);
    },
  }, async (request, reply) => {
    const data = registerSchema.parse(request.body);

    // Check if user already exists by email
    const existingByEmail = await prisma.user.findUnique({ where: { email: data.email } });
    if (existingByEmail) {
      throw app.httpErrors.conflict('Email already registered');
    }

    // Phone handling (encrypt + hash)
    let phoneEncrypted: string | undefined;
    let phoneSearchHash: string | undefined;
    if (data.phone) {
      const normalized = normalizePhone(data.phone);
      phoneEncrypted = await encrypt(data.phone);
      phoneSearchHash = hashForSearch(normalized);

      const existingByPhone = await prisma.user.findFirst({ where: { phoneSearchHash } });
      if (existingByPhone) {
        throw app.httpErrors.conflict('Phone number already registered');
      }
    }

    // Hash password
    const passwordHash = await hashPassword(data.password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: phoneEncrypted,
        phoneSearchHash,
        role: 'USER',
        gdprConsent: {
          functional: true,
          analytics: data.marketingConsent,
          marketing: data.marketingConsent,
          timestamp: new Date().toISOString(),
        },
        marketingConsent: data.marketingConsent as any,
        preferences: {
          create: {
            alertRadiusM: 2000,
            categories: {
              crime: true,
              weather: true,
              transport: true,
              fire: true,
              flood: true,
            },
            theme: 'LIGHT',
            pushEnabled: true,
            emailEnabled: true,
          },
        },
      },
      include: { preferences: true },
    });

    // Generate session ID
    const sessionId = generateSecureToken();

    // Create JWT tokens
    const tokens = await createTokenPair({
      sub: user.id,
      email: user.email,
      role: user.role,
      sessionId,
    });

    // Set refresh token cookie
    setRefreshCookie(reply, tokens.refreshToken);

    // Send welcome email (async)
    sendWelcomeEmail(user.email, `${user.firstName} ${user.lastName}`)
      .catch(error => logger.warn('Failed to send welcome email:', error));

    // Audit log
    logAuditEvent({
      actorId: user.id,
      action: 'user_registered',
      resource: 'user',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
      metadata: { email: user.email, registrationMethod: 'email' },
    });

    reply.code(201).send({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      tokens: { ...tokens, refreshToken: undefined },
    });
  });

  /**
   * Login user
   */
  app.post('/login', {
    schema: { tags: ['Auth'], summary: 'Login user' },
    preHandler: async (req, reply) => {
      const { ipRateLimitMiddleware } = await import('../middleware/auth.js');
      await ipRateLimitMiddleware(req, reply, 10, 3600000);
    },
  }, async (request, reply) => {
    const data = loginSchema.parse(request.body);

    // Find user
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !user.passwordHash) {
      logSecurityEvent({ type: 'failed_login', severity: 'low', source: request.ip, metadata: { email: data.email, reason: 'user_not_found' } });
      throw app.httpErrors.unauthorized('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await verifyPassword(data.password, user.passwordHash);
    if (!isPasswordValid) {
      logSecurityEvent({ type: 'failed_login', severity: 'low', source: request.ip, userId: user.id, metadata: { email: data.email, reason: 'invalid_password' } });
      throw app.httpErrors.unauthorized('Invalid credentials');
    }

    // Check account status
    if (!user.isActive || user.isBanned || user.deletedAt) {
      logSecurityEvent({ type: 'failed_login', severity: 'medium', source: request.ip, userId: user.id, metadata: { email: data.email, reason: user.isBanned ? 'banned' : 'inactive' } });
      throw app.httpErrors.forbidden('Account is inactive or banned');
    }

    // 2FA check
    if (user.twoFAEnabled) {
      if (!data.twoFACode) {
        return reply.code(202).send({ requiresTwoFA: true, message: '2FA code required' });
      }
      const twoFAResult = await verify2FA(user.id, data.twoFACode);
      if (!twoFAResult.isValid) {
        logSecurityEvent({ type: 'failed_login', severity: 'medium', source: request.ip, userId: user.id, metadata: { email: data.email, reason: '2fa_failed' } });
        throw app.httpErrors.unauthorized('Invalid 2FA code');
      }
    }

    // Generate session ID
    const sessionId = generateSecureToken();

    // Create JWT tokens
    const tokens = await createTokenPair({
      sub: user.id,
      email: user.email,
      role: user.role,
      sessionId,
    });

    // Update user login info
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIP: request.ip, loginCount: { increment: 1 } },
    });

    // Set refresh cookie
    setRefreshCookie(reply, tokens.refreshToken);

    // Log successful login
    logAuditEvent({ actorId: user.id, action: 'user_login', resource: 'user', resourceId: user.id, success: true, ipAddress: request.ip, metadata: { email: user.email, twoFAUsed: user.twoFAEnabled } });

    reply.send({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        isPremium: user.isPremium,
        emailVerified: user.emailVerified,
      },
      tokens: { ...tokens, refreshToken: undefined },
    });
  });

  /**
   * Refresh access token (supports cookie-based refresh token)
   */
  app.post('/refresh', {
    schema: { tags: ['Auth'], summary: 'Refresh access token' },
  }, async (request, reply) => {
    const body = refreshSchema.parse(request.body || {});
    const cookieRefresh = (request.cookies && (request.cookies['ssg_refresh'] as string)) || undefined;
    const refreshToken = body.refreshToken || cookieRefresh;

    if (!refreshToken) {
      throw app.httpErrors.unauthorized('Refresh token required');
    }

    try {
      const tokens = await refreshAccessToken(refreshToken);
      setRefreshCookie(reply, tokens.refreshToken);
      reply.send({ tokens: { ...tokens, refreshToken: undefined } });
    } catch (error) {
      throw app.httpErrors.unauthorized('Invalid refresh token');
    }
  });

  /**
   * Logout user
   */
  app.post('/logout', {
    preHandler: [app.authenticate],
    schema: { tags: ['Auth'], summary: 'Logout user', security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    const user = request.user!;
    await revokeUserSession(user.id, user.sessionId);

    // Clear refresh cookie
    reply.clearCookie('ssg_refresh', { path: '/' });

    logAuditEvent({ actorId: user.id, action: 'user_logout', resource: 'user', resourceId: user.id, success: true, ipAddress: request.ip });
    reply.send({ message: 'Logged out successfully' });
  });

  /**
   * Setup 2FA
   */
  app.post('/2fa/setup', { preHandler: [app.authenticate], schema: { tags: ['Auth'], summary: 'Setup 2FA', security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const user = request.user!;
    const currentUser = await prisma.user.findUnique({ where: { id: user.id }, select: { twoFAEnabled: true } });
    if (currentUser?.twoFAEnabled) throw app.httpErrors.conflict('2FA is already enabled');
    const setup = await generate2FASetup(user.id, user.email);
    reply.send({ secret: setup.secret, qrCodeUrl: setup.qrCodeUrl, backupCodes: setup.backupCodes, manualEntryKey: setup.manualEntryKey });
  });

  app.post('/2fa/verify-setup', { preHandler: [app.authenticate], schema: { tags: ['Auth'], summary: 'Verify 2FA setup', security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const user = request.user!;
    const data = setup2FASchema.parse(request.body);
    const isValid = await verify2FASetup(user.id, data.token);
    if (!isValid) throw app.httpErrors.badRequest('Invalid 2FA token');
    logAuditEvent({ actorId: user.id, action: '2fa_enabled', resource: 'user', resourceId: user.id, success: true, ipAddress: request.ip });
    reply.send({ message: '2FA enabled successfully' });
  });

  app.post('/2fa/disable', { preHandler: [app.authenticate], schema: { tags: ['Auth'], summary: 'Disable 2FA', security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const user = request.user!;
    const data = verify2FASchema.parse(request.body);
    const verification = await verify2FA(user.id, data.token);
    if (!verification.isValid) throw app.httpErrors.badRequest('Invalid 2FA token');
    await disable2FA(user.id);
    logAuditEvent({ actorId: user.id, action: '2fa_disabled', resource: 'user', resourceId: user.id, success: true, ipAddress: request.ip });
    reply.send({ message: '2FA disabled successfully' });
  });

  app.get('/2fa/status', { preHandler: [app.authenticate], schema: { tags: ['Auth'], summary: 'Get 2FA status', security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const user = request.user!;
    const status = await get2FAStatus(user.id);
    reply.send(status);
  });

  app.post('/2fa/backup-codes', { preHandler: [app.authenticate], schema: { tags: ['Auth'], summary: 'Regenerate 2FA backup codes', security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const user = request.user!;
    const data = verify2FASchema.parse(request.body);
    const verification = await verify2FA(user.id, data.token);
    if (!verification.isValid) throw app.httpErrors.badRequest('Invalid 2FA token');
    const backupCodes = await regenerateBackupCodes(user.id);
    logAuditEvent({ actorId: user.id, action: '2fa_backup_codes_regenerated', resource: 'user', resourceId: user.id, success: true, ipAddress: request.ip });
    reply.send({ backupCodes });
  });

  /**
   * Get current user info (decrypt sensitive fields)
   */
  app.get('/me', { preHandler: [app.authenticate], schema: { tags: ['Auth'], summary: 'Get current user information', security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const user = request.user!;
    const userData = await prisma.user.findUnique({ where: { id: user.id }, include: { preferences: true } });
    if (!userData) throw app.httpErrors.notFound('User not found');

    let phone: string | null = null;
    if (userData.phone) {
      try { phone = await decrypt(userData.phone); } catch { phone = null; }
    }

    reply.send({
      id: userData.id,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      phone,
      role: userData.role,
      isPremium: userData.isPremium,
      premiumUntil: userData.premiumUntil,
      emailVerified: userData.emailVerified,
      phoneVerified: userData.phoneVerified,
      twoFAEnabled: userData.twoFAEnabled,
      locale: userData.locale,
      timezone: userData.timezone,
      preferences: userData.preferences,
      createdAt: userData.createdAt,
      lastLoginAt: userData.lastLoginAt,
    });
  });

  /**
   * OAuth2/OIDC providers (Google & Apple scaffolding)
   */
  try {
    const oauth2 = await import('@fastify/oauth2');

    // Google OAuth2
    if (app.config.oauth.google.clientId && app.config.oauth.google.clientSecret) {
      await app.register((oauth2 as any).default, {
        name: 'googleOAuth2',
        scope: ['profile', 'email'],
        credentials: {
          client: {
            id: app.config.oauth.google.clientId!,
            secret: app.config.oauth.google.clientSecret!,
          },
          auth: oauth2.GOOGLE_CONFIGURATION,
        },
        startRedirectPath: '/api/auth/oauth/google',
        callbackUri: '/api/auth/oauth/google/callback',
      } as any);

      app.get('/oauth/google/callback', async (request, reply) => {
        const token = await (app as any).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
        const accessToken = token.token.access_token as string;
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const profile = await profileRes.json();
        const email = profile.email as string;
        const firstName = profile.given_name || 'User';
        const lastName = profile.family_name || 'Google';

        // Upsert user
        const user = await prisma.user.upsert({
          where: { email },
          update: { emailVerified: true, firstName, lastName },
          create: { email, firstName, lastName, emailVerified: true, role: 'USER' },
        });

        const sessionId = generateSecureToken();
        const tokens = await createTokenPair({ sub: user.id, email: user.email, role: user.role, sessionId });
        setRefreshCookie(reply, tokens.refreshToken);

        reply.send({
          user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
          tokens: { ...tokens, refreshToken: undefined },
        });
      });
    } else {
      logger.warn('Google OAuth2 not configured');
    }

    // Apple OAuth2 (scaffold only)
    if (app.config.oauth.apple.clientId && app.config.oauth.apple.clientSecret) {
      await app.register(oauth2.default, {
        name: 'appleOAuth2',
        scope: ['name', 'email'],
        credentials: {
          client: {
            id: app.config.oauth.apple.clientId!,
            secret: app.config.oauth.apple.clientSecret!,
          },
          auth: {
            tokenHost: 'https://appleid.apple.com',
            tokenPath: '/auth/token',
            authorizeHost: 'https://appleid.apple.com',
            authorizePath: '/auth/authorize',
          },
        },
        startRedirectPath: '/api/auth/oauth/apple',
        callbackUri: '/api/auth/oauth/apple/callback',
      } as any);

      app.get('/oauth/apple/callback', async (request, reply) => {
        // NOTE: Real Apple Sign-In requires JWT client secret and decoding id_token.
        // Here we provide a minimal scaffold and return 501 to indicate further setup needed.
        reply.code(501).send({ error: 'APPLE_OAUTH_SETUP_REQUIRED', message: 'Apple OAuth requires additional configuration' });
      });
    } else {
      logger.warn('Apple OAuth2 not configured');
    }
  } catch (e) {
    logger.warn('OAuth2 plugins not available or failed to load', e);
  }
}