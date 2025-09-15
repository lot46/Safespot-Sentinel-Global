/**
 * SafeSpot Sentinel Global V2 - Authentication Routes
 * JWT-based auth with 2FA, OAuth2, and security features
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger, logAuditEvent, logSecurityEvent } from '../utils/logger.js';
import { hashPassword, verifyPassword } from '../security/encryption.js';
import { createTokenPair, refreshAccessToken, revokeUserSession } from '../auth/jwt.js';
import { 
  generate2FASetup, 
  verify2FASetup, 
  verify2FA, 
  disable2FA,
  get2FAStatus,
  regenerateBackupCodes 
} from '../auth/2fa.js';
import { sendWelcomeEmail, sendEmailVerification } from '../integrations/email.js';
import { generateSecureToken } from '../security/encryption.js';

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
  refreshToken: z.string(),
});

const setup2FASchema = z.object({
  token: z.string().length(6),
});

const verify2FASchema = z.object({
  token: z.string(),
});

export default async function authRoutes(app: FastifyInstance) {
  
  /**
   * Register new user
   */
  app.post('/register', {
    schema: {
      tags: ['Auth'],
      summary: 'Register new user account',
      body: {
        type: 'object',
        required: ['email', 'password', 'firstName', 'lastName', 'gdprConsent'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8, maxLength: 128 },
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', minLength: 1, maxLength: 100 },
          phone: { type: 'string' },
          gdprConsent: { type: 'boolean' },
          marketingConsent: { type: 'boolean' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                role: { type: 'string' },
                emailVerified: { type: 'boolean' },
              },
            },
            tokens: {
              type: 'object',
              properties: {
                accessToken: { type: 'string' },
                refreshToken: { type: 'string' },
                expiresIn: { type: 'number' },
                tokenType: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const data = registerSchema.parse(request.body);

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: data.email },
          ...(data.phone ? [{ phone: data.phone }] : []),
        ],
      },
    });

    if (existingUser) {
      if (existingUser.email === data.email) {
        throw app.httpErrors.conflict('Email already registered');
      }
      if (existingUser.phone === data.phone) {
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
        phone: data.phone,
        role: 'USER',
        gdprConsent: {
          functional: true,
          analytics: data.marketingConsent,
          marketing: data.marketingConsent,
          timestamp: new Date().toISOString(),
        },
        marketingConsent: data.marketingConsent,
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
      include: {
        preferences: true,
      },
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

    // Send welcome email (async)
    sendWelcomeEmail(user.email, `${user.firstName} ${user.lastName}`)
      .catch(error => {
        logger.warn('Failed to send welcome email:', error);
      });

    // Log audit event
    logAuditEvent({
      actorId: user.id,
      action: 'user_registered',
      resource: 'user',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
      metadata: {
        email: user.email,
        registrationMethod: 'email',
      },
    });

    logger.info('User registered successfully', { 
      userId: user.id, 
      email: user.email,
      ip: request.ip 
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
      tokens,
    });
  });

  /**
   * Login user
   */
  app.post('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login user',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
          twoFACode: { type: 'string' },
          rememberMe: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const data = loginSchema.parse(request.body);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user || !user.passwordHash) {
      // Log failed login attempt
      logSecurityEvent({
        type: 'failed_login',
        severity: 'low',
        source: request.ip,
        metadata: {
          email: data.email,
          reason: 'user_not_found',
        },
      });

      // Generic error to prevent user enumeration
      throw app.httpErrors.unauthorized('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await verifyPassword(data.password, user.passwordHash);
    if (!isPasswordValid) {
      logSecurityEvent({
        type: 'failed_login',
        severity: 'low',
        source: request.ip,
        userId: user.id,
        metadata: {
          email: data.email,
          reason: 'invalid_password',
        },
      });

      throw app.httpErrors.unauthorized('Invalid credentials');
    }

    // Check if account is active
    if (!user.isActive || user.isBanned || user.deletedAt) {
      logSecurityEvent({
        type: 'failed_login',
        severity: 'medium',
        source: request.ip,
        userId: user.id,
        metadata: {
          email: data.email,
          reason: user.isBanned ? 'banned' : 'inactive',
        },
      });

      throw app.httpErrors.forbidden('Account is inactive or banned');
    }

    // Check 2FA if enabled
    if (user.twoFAEnabled) {
      if (!data.twoFACode) {
        return reply.code(202).send({
          requiresTwoFA: true,
          message: '2FA code required',
        });
      }

      const twoFAResult = await verify2FA(user.id, data.twoFACode);
      if (!twoFAResult.isValid) {
        logSecurityEvent({
          type: 'failed_login',
          severity: 'medium',
          source: request.ip,
          userId: user.id,
          metadata: {
            email: data.email,
            reason: '2fa_failed',
          },
        });

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
      data: {
        lastLoginAt: new Date(),
        lastLoginIP: request.ip,
        loginCount: { increment: 1 },
      },
    });

    // Log successful login
    logAuditEvent({
      actorId: user.id,
      action: 'user_login',
      resource: 'user',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
      metadata: {
        email: user.email,
        twoFAUsed: user.twoFAEnabled,
      },
    });

    logger.info('User logged in successfully', { 
      userId: user.id, 
      email: user.email,
      ip: request.ip 
    });

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
      tokens,
    });
  });

  /**
   * Refresh access token
   */
  app.post('/refresh', {
    schema: {
      tags: ['Auth'],
      summary: 'Refresh access token',
    },
  }, async (request, reply) => {
    const data = refreshSchema.parse(request.body);

    try {
      const tokens = await refreshAccessToken(data.refreshToken);
      
      reply.send({ tokens });
    } catch (error) {
      throw app.httpErrors.unauthorized('Invalid refresh token');
    }
  });

  /**
   * Logout user
   */
  app.post('/logout', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Logout user',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;

    // Revoke user session
    await revokeUserSession(user.id, user.sessionId);

    // Log logout
    logAuditEvent({
      actorId: user.id,
      action: 'user_logout',
      resource: 'user',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
    });

    reply.send({ message: 'Logged out successfully' });
  });

  /**
   * Setup 2FA
   */
  app.post('/2fa/setup', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Setup 2FA for user',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;

    // Check if 2FA is already enabled
    const currentUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFAEnabled: true },
    });

    if (currentUser?.twoFAEnabled) {
      throw app.httpErrors.conflict('2FA is already enabled');
    }

    const setup = await generate2FASetup(user.id, user.email);

    reply.send({
      secret: setup.secret,
      qrCodeUrl: setup.qrCodeUrl,
      backupCodes: setup.backupCodes,
      manualEntryKey: setup.manualEntryKey,
    });
  });

  /**
   * Verify and complete 2FA setup
   */
  app.post('/2fa/verify-setup', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Verify 2FA setup',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = setup2FASchema.parse(request.body);

    const isValid = await verify2FASetup(user.id, data.token);

    if (!isValid) {
      throw app.httpErrors.badRequest('Invalid 2FA token');
    }

    // Log 2FA enabled
    logAuditEvent({
      actorId: user.id,
      action: '2fa_enabled',
      resource: 'user',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
    });

    reply.send({ message: '2FA enabled successfully' });
  });

  /**
   * Disable 2FA
   */
  app.post('/2fa/disable', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Disable 2FA',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = verify2FASchema.parse(request.body);

    // Verify current 2FA code before disabling
    const verification = await verify2FA(user.id, data.token);
    if (!verification.isValid) {
      throw app.httpErrors.badRequest('Invalid 2FA token');
    }

    await disable2FA(user.id);

    // Log 2FA disabled
    logAuditEvent({
      actorId: user.id,
      action: '2fa_disabled',
      resource: 'user',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
    });

    reply.send({ message: '2FA disabled successfully' });
  });

  /**
   * Get 2FA status
   */
  app.get('/2fa/status', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Get 2FA status',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;
    const status = await get2FAStatus(user.id);
    reply.send(status);
  });

  /**
   * Regenerate 2FA backup codes
   */
  app.post('/2fa/backup-codes', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Regenerate 2FA backup codes',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = verify2FASchema.parse(request.body);

    // Verify current 2FA code before regenerating
    const verification = await verify2FA(user.id, data.token);
    if (!verification.isValid) {
      throw app.httpErrors.badRequest('Invalid 2FA token');
    }

    const backupCodes = await regenerateBackupCodes(user.id);

    // Log backup codes regenerated
    logAuditEvent({
      actorId: user.id,
      action: '2fa_backup_codes_regenerated',
      resource: 'user',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
    });

    reply.send({ backupCodes });
  });

  /**
   * Get current user info
   */
  app.get('/me', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Get current user information',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;

    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        preferences: true,
      },
    });

    if (!userData) {
      throw app.httpErrors.notFound('User not found');
    }

    reply.send({
      id: userData.id,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      phone: userData.phone,
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
}