/**
 * SafeSpot Sentinel Global V2 - Authentication Routes
 */
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger, logAuditEvent, logSecurityEvent } from '../utils/logger.js';
import { hashPassword, verifyPassword, encrypt, decrypt, normalizePhone, hashForSearch, generateSecureToken } from '../security/encryption.js';
import { createTokenPair, refreshAccessToken, revokeUserSession } from '../auth/jwt.js';

const prisma = getPrisma();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().optional(),
  gdprConsent: z.boolean(),
  marketingConsent: z.boolean().default(false),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  twoFACode: z.string().optional(),
  rememberMe: z.boolean().default(false),
});

export default async function authRoutes(app: FastifyInstance) {
  // Helpers to set cookies
  function setRefreshCookie(reply: any, token: string) {
    reply.setCookie('ssg_refresh', token, {
      httpOnly: true,
      secure: app.config.app.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });
  }
  function setCSRFCookie(reply: any, token: string) {
    reply.setCookie('ssg_csrf', token, {
      httpOnly: false,
      secure: app.config.app.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60,
    });
  }

  app.get('/csrf', { schema: { tags: ['Auth'], summary: 'Get CSRF token' } }, async (_request, reply) => {
    const csrfToken = generateSecureToken(16);
    setCSRFCookie(reply, csrfToken);
    reply.send({ csrfToken });
  });

  app.post('/register', {
    schema: { tags: ['Auth'], summary: 'Register' },
    preHandler: async (req, reply) => {
      const { ipRateLimitMiddleware } = await import('../middleware/auth.js');
      await ipRateLimitMiddleware(req, reply, 10, 3600000);
    },
  }, async (request, reply) => {
    const data = registerSchema.parse(request.body);

    const existingByEmail = await prisma.user.findUnique({ where: { email: data.email } });
    if (existingByEmail) throw app.httpErrors.conflict('Email already registered');

    let phoneEncrypted: string | undefined;
    let phoneSearchHash: string | undefined;
    if (data.phone) {
      const normalized = normalizePhone(data.phone);
      phoneEncrypted = await encrypt(data.phone);
      phoneSearchHash = hashForSearch(normalized);
      const existingByPhone = await prisma.user.findFirst({ where: { phoneSearchHash } });
      if (existingByPhone) throw app.httpErrors.conflict('Phone number already registered');
    }

    const passwordHash = await hashPassword(data.password);

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
        } as any,
        preferences: {
          create: { alertRadiusM: 2000, categories: { crime: true, weather: true, transport: true }, theme: 'LIGHT', pushEnabled: true, emailEnabled: true },
        },
      },
      include: { preferences: true },
    });

    const sessionId = generateSecureToken();
    const tokens = await createTokenPair({ sub: user.id, email: user.email, role: user.role, sessionId });
    setRefreshCookie(reply, tokens.refreshToken);

    logAuditEvent({ actorId: user.id, action: 'user_registered', resource: 'user', resourceId: user.id, success: true, ipAddress: request.ip, metadata: { email: user.email, registrationMethod: 'email' } });

    reply.code(201).send({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, emailVerified: user.emailVerified }, tokens: { ...tokens, refreshToken: undefined } });
  });

  app.post('/login', { schema: { tags: ['Auth'], summary: 'Login' }, preHandler: async (req, reply) => { const { ipRateLimitMiddleware } = await import('../middleware/auth.js'); await ipRateLimitMiddleware(req, reply, 10, 3600000); } }, async (request, reply) => {
    const data = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !user.passwordHash) { logSecurityEvent({ type: 'failed_login', severity: 'low', source: request.ip, metadata: { email: data.email, reason: 'user_not_found' } }); throw app.httpErrors.unauthorized('Invalid credentials'); }
    const isPasswordValid = await verifyPassword(data.password, user.passwordHash);
    if (!isPasswordValid) { logSecurityEvent({ type: 'failed_login', severity: 'low', source: request.ip, userId: user.id, metadata: { email: data.email, reason: 'invalid_password' } }); throw app.httpErrors.unauthorized('Invalid credentials'); }
    if (!user.isActive || user.isBanned || user.deletedAt) { logSecurityEvent({ type: 'failed_login', severity: 'medium', source: request.ip, userId: user.id, metadata: { email: data.email, reason: user.isBanned ? 'banned' : 'inactive' } }); throw app.httpErrors.forbidden('Account is inactive or banned'); }

    const sessionId = generateSecureToken();
    const tokens = await createTokenPair({ sub: user.id, email: user.email, role: user.role, sessionId });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastLoginIP: request.ip, loginCount: { increment: 1 } } });
    setRefreshCookie(reply, tokens.refreshToken);
    logAuditEvent({ actorId: user.id, action: 'user_login', resource: 'user', resourceId: user.id, success: true, ipAddress: request.ip, metadata: { email: user.email, twoFAUsed: user.twoFAEnabled } });
    reply.send({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, isPremium: user.isPremium, emailVerified: user.emailVerified }, tokens: { ...tokens, refreshToken: undefined } });
  });

  app.post('/refresh', { schema: { tags: ['Auth'], summary: 'Refresh access token' } }, async (request, reply) => {
    const cookieRefresh = (request.cookies && (request.cookies['ssg_refresh'] as string)) || undefined;
    const body = (request.body as any) || {};
    const refreshToken = body.refreshToken || cookieRefresh;
    if (!refreshToken) throw app.httpErrors.unauthorized('Refresh token required');
    const tokens = await refreshAccessToken(refreshToken);
    setRefreshCookie(reply, tokens.refreshToken);
    reply.send({ tokens: { ...tokens, refreshToken: undefined } });
  });

  app.post('/logout', { preHandler: [app.authenticate], schema: { tags: ['Auth'], summary: 'Logout', security: [{ bearerAuth: [] }] } }, async (request, reply) => {
    const user = request.user!;
    await revokeUserSession(user.id, user.sessionId);
    reply.clearCookie('ssg_refresh', { path: '/' });
    logAuditEvent({ actorId: user.id, action: 'user_logout', resource: 'user', resourceId: user.id, success: true, ipAddress: request.ip });
    reply.send({ message: 'Logged out successfully' });
  });

  // OAuth2 providers
  try {
    const oauth2: any = await import('@fastify/oauth2');
    if (app.config.oauth.google.clientId && app.config.oauth.google.clientSecret) {
      await app.register((oauth2 as any).default, {
        name: 'googleOAuth2',
        scope: ['profile', 'email'],
        credentials: { client: { id: app.config.oauth.google.clientId!, secret: app.config.oauth.google.clientSecret! }, auth: (oauth2 as any).GOOGLE_CONFIGURATION },
        startRedirectPath: '/api/auth/oauth/google',
        callbackUri: '/api/auth/oauth/google/callback',
      } as any);

      app.get('/oauth/google/callback', async (request, reply) => {
        const token = await (app as any).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
        const accessToken = token.token.access_token as string;
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
        const profile = await profileRes.json();
        const email = profile.email as string;
        const firstName = profile.given_name || 'User';
        const lastName = profile.family_name || 'Google';
        const user = await prisma.user.upsert({ where: { email }, update: { emailVerified: true, firstName, lastName }, create: { email, firstName, lastName, emailVerified: true, role: 'USER' } });
        const sessionId = generateSecureToken();
        const tokens = await createTokenPair({ sub: user.id, email: user.email, role: user.role, sessionId });
        setRefreshCookie(reply, tokens.refreshToken);
        reply.send({ user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }, tokens: { ...tokens, refreshToken: undefined } });
      });
    }

    if (app.config.oauth.apple.clientId && app.config.oauth.apple.clientSecret) {
      await app.register((oauth2 as any).default, {
        name: 'appleOAuth2',
        scope: ['name', 'email'],
        credentials: {
          client: { id: app.config.oauth.apple.clientId!, secret: app.config.oauth.apple.clientSecret! },
          auth: { tokenHost: 'https://appleid.apple.com', tokenPath: '/auth/token', authorizeHost: 'https://appleid.apple.com', authorizePath: '/auth/authorize' },
        },
        startRedirectPath: '/api/auth/oauth/apple',
        callbackUri: '/api/auth/oauth/apple/callback',
      } as any);

      app.get('/oauth/apple/callback', async (_request, reply) => {
        reply.code(501).send({ error: 'APPLE_OAUTH_SETUP_REQUIRED', message: 'Apple OAuth requires additional configuration' });
      });
    }
  } catch (e) {
    logger.warn('OAuth2 plugins not available or failed to load');
  }
}