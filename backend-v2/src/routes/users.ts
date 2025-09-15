/**
 * SafeSpot Sentinel Global V2 - User Management Routes
 * GDPR-compliant user management with data export/deletion
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger, logAuditEvent } from '../utils/logger.js';
import { hashPassword, verifyPassword, anonymizeData } from '../security/encryption.js';
import { sendEmailVerification, sendSecurityAlert } from '../integrations/email.js';

const prisma = getPrisma();

// Validation schemas
const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().optional(),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(50).optional(),
});

const updatePreferencesSchema = z.object({
  alertRadiusM: z.number().min(500).max(50000).optional(),
  categories: z.record(z.boolean()).optional(),
  theme: z.enum(['LIGHT', 'DARK', 'AUTO']).optional(),
  sosMessage: z.string().max(500).optional(),
  pushEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  locationSharing: z.boolean().optional(),
  profileVisible: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8).max(128),
});

const addContactSchema = z.object({
  type: z.enum(['EMAIL', 'SMS', 'PUSH']),
  value: z.string().min(1).max(255),
  label: z.string().min(1).max(100),
  relationship: z.string().max(50).optional(),
  priority: z.number().min(1).max(10).default(1),
});

export default async function userRoutes(app: FastifyInstance) {

  /**
   * Update user profile
   */
  app.patch('/profile', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Update user profile',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', minLength: 1, maxLength: 100 },
          phone: { type: 'string' },
          locale: { type: 'string', maxLength: 10 },
          timezone: { type: 'string', maxLength: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = updateProfileSchema.parse(request.body);

    // Check if phone number is already used by another user
    if (data.phone) {
      const existingUser = await prisma.user.findFirst({
        where: { 
          phone: data.phone,
          id: { not: user.id },
        },
      });

      if (existingUser) {
        throw app.httpErrors.conflict('Phone number already in use');
      }
    }

    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...data,
        updatedAt: new Date(),
        ...(data.phone && { phoneVerified: false }), // Reset phone verification if changed
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        phoneVerified: true,
        locale: true,
        timezone: true,
        updatedAt: true,
      },
    });

    // Log profile update
    logAuditEvent({
      actorId: user.id,
      action: 'profile_updated',
      resource: 'user',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
      metadata: {
        fieldsUpdated: Object.keys(data),
      },
    });

    reply.send(updatedUser);
  });

  /**
   * Update user preferences
   */
  app.patch('/preferences', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Update user preferences',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          alertRadiusM: { type: 'number', minimum: 500, maximum: 50000 },
          categories: { type: 'object' },
          theme: { type: 'string', enum: ['LIGHT', 'DARK', 'AUTO'] },
          sosMessage: { type: 'string', maxLength: 500 },
          pushEnabled: { type: 'boolean' },
          emailEnabled: { type: 'boolean' },
          smsEnabled: { type: 'boolean' },
          locationSharing: { type: 'boolean' },
          profileVisible: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = updatePreferencesSchema.parse(request.body);

    // Validate alert radius for non-premium users
    if (data.alertRadiusM && data.alertRadiusM > 5000 && !user.isPremium) {
      throw app.httpErrors.paymentRequired('Premium subscription required for extended alert radius');
    }

    // Update or create preferences
    const preferences = await prisma.userPreferences.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        ...data,
      },
      update: {
        ...data,
        updatedAt: new Date(),
      },
    });

    // Log preferences update
    logAuditEvent({
      actorId: user.id,
      action: 'preferences_updated',
      resource: 'user_preferences',
      resourceId: preferences.id,
      success: true,
      ipAddress: request.ip,
      metadata: {
        fieldsUpdated: Object.keys(data),
      },
    });

    reply.send(preferences);
  });

  /**
   * Change password
   */
  app.post('/change-password', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Change user password',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 8, maxLength: 128 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = changePasswordSchema.parse(request.body);

    // Get current user with password hash
    const currentUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true, email: true, firstName: true, lastName: true },
    });

    if (!currentUser?.passwordHash) {
      throw app.httpErrors.badRequest('Password not set for this account');
    }

    // Verify current password
    const isCurrentPasswordValid = await verifyPassword(data.currentPassword, currentUser.passwordHash);
    if (!isCurrentPasswordValid) {
      // Log failed password change attempt
      logAuditEvent({
        actorId: user.id,
        action: 'password_change_failed',
        resource: 'user',
        resourceId: user.id,
        success: false,
        ipAddress: request.ip,
        metadata: { reason: 'invalid_current_password' },
      });

      throw app.httpErrors.badRequest('Current password is incorrect');
    }

    // Hash new password
    const newPasswordHash = await hashPassword(data.newPassword);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        updatedAt: new Date(),
      },
    });

    // Send security alert email
    sendSecurityAlert(
      currentUser.email,
      'Mot de passe modifié',
      'Votre mot de passe SafeSpot Sentinel a été modifié avec succès. Si ce n\'était pas vous, contactez immédiatement le support.'
    ).catch(error => {
      logger.warn('Failed to send password change alert email:', error);
    });

    // Log successful password change
    logAuditEvent({
      actorId: user.id,
      action: 'password_changed',
      resource: 'user',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
    });

    reply.send({ message: 'Password changed successfully' });
  });

  /**
   * Add emergency contact
   */
  app.post('/contacts', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Add emergency contact',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['type', 'value', 'label'],
        properties: {
          type: { type: 'string', enum: ['EMAIL', 'SMS', 'PUSH'] },
          value: { type: 'string', minLength: 1, maxLength: 255 },
          label: { type: 'string', minLength: 1, maxLength: 100 },
          relationship: { type: 'string', maxLength: 50 },
          priority: { type: 'number', minimum: 1, maximum: 10, default: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = addContactSchema.parse(request.body);

    // Check contact limits for non-premium users
    const contactCount = await prisma.userContact.count({
      where: { userId: user.id, isActive: true },
    });

    const maxContacts = user.isPremium ? 50 : 5;
    if (contactCount >= maxContacts) {
      throw app.httpErrors.paymentRequired(
        `Contact limit reached. ${user.isPremium ? '' : 'Upgrade to Premium for more contacts.'}`
      );
    }

    // Check if contact already exists
    const existingContact = await prisma.userContact.findFirst({
      where: {
        userId: user.id,
        type: data.type,
        value: data.value,
        isActive: true,
      },
    });

    if (existingContact) {
      throw app.httpErrors.conflict('Contact already exists');
    }

    // Create contact
    const contact = await prisma.userContact.create({
      data: {
        userId: user.id,
        ...data,
      },
    });

    // Log contact addition
    logAuditEvent({
      actorId: user.id,
      action: 'contact_added',
      resource: 'user_contact',
      resourceId: contact.id,
      success: true,
      ipAddress: request.ip,
      metadata: {
        type: data.type,
        label: data.label,
      },
    });

    reply.code(201).send(contact);
  });

  /**
   * Get user's emergency contacts
   */
  app.get('/contacts', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Get user emergency contacts',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;

    const contacts = await prisma.userContact.findMany({
      where: { 
        userId: user.id, 
        isActive: true,
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'asc' },
      ],
      select: {
        id: true,
        type: true,
        value: true,
        label: true,
        relationship: true,
        priority: true,
        verified: true,
        createdAt: true,
      },
    });

    reply.send(contacts);
  });

  /**
   * Update emergency contact
   */
  app.patch('/contacts/:contactId', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Update emergency contact',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { contactId } = request.params as { contactId: string };
    const data = addContactSchema.partial().parse(request.body);

    // Find and verify ownership
    const contact = await prisma.userContact.findFirst({
      where: {
        id: contactId,
        userId: user.id,
        isActive: true,
      },
    });

    if (!contact) {
      throw app.httpErrors.notFound('Contact not found');
    }

    // Update contact
    const updatedContact = await prisma.userContact.update({
      where: { id: contactId },
      data: {
        ...data,
        updatedAt: new Date(),
        ...(data.value && { verified: false }), // Reset verification if value changed
      },
    });

    // Log contact update
    logAuditEvent({
      actorId: user.id,
      action: 'contact_updated',
      resource: 'user_contact',
      resourceId: contactId,
      success: true,
      ipAddress: request.ip,
      metadata: {
        fieldsUpdated: Object.keys(data),
      },
    });

    reply.send(updatedContact);
  });

  /**
   * Delete emergency contact
   */
  app.delete('/contacts/:contactId', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Delete emergency contact',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          contactId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { contactId } = request.params as { contactId: string };

    // Find and verify ownership
    const contact = await prisma.userContact.findFirst({
      where: {
        id: contactId,
        userId: user.id,
        isActive: true,
      },
    });

    if (!contact) {
      throw app.httpErrors.notFound('Contact not found');
    }

    // Soft delete contact
    await prisma.userContact.update({
      where: { id: contactId },
      data: { isActive: false },
    });

    // Log contact deletion
    logAuditEvent({
      actorId: user.id,
      action: 'contact_deleted',
      resource: 'user_contact',
      resourceId: contactId,
      success: true,
      ipAddress: request.ip,
    });

    reply.send({ message: 'Contact deleted successfully' });
  });

  /**
   * Export user data (GDPR compliance)
   */
  app.post('/export', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Export user data (GDPR)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
          includeReports: { type: 'boolean', default: true },
          includeSOSSessions: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { format = 'json', includeReports = true, includeSOSSessions = true } = request.body as any;

    // Get user data
    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        preferences: true,
        contacts: {
          where: { isActive: true },
        },
        ...(includeReports && {
          reports: {
            where: { deletedAt: null },
            select: {
              id: true,
              type: true,
              title: true,
              description: true,
              latitude: true,
              longitude: true,
              address: true,
              status: true,
              trustScore: true,
              createdAt: true,
            },
          },
        }),
        ...(includeSOSSessions && {
          sosSessions: {
            select: {
              id: true,
              state: true,
              message: true,
              startedAt: true,
              endedAt: true,
            },
          },
        }),
        payments: {
          select: {
            id: true,
            plan: true,
            amount: true,
            currency: true,
            status: true,
            startedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!userData) {
      throw app.httpErrors.notFound('User not found');
    }

    // Remove sensitive data
    const exportData = {
      profile: {
        id: userData.id,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
        locale: userData.locale,
        timezone: userData.timezone,
        role: userData.role,
        isPremium: userData.isPremium,
        createdAt: userData.createdAt,
        lastLoginAt: userData.lastLoginAt,
      },
      preferences: userData.preferences,
      contacts: userData.contacts?.map(contact => ({
        id: contact.id,
        type: contact.type,
        label: contact.label,
        relationship: contact.relationship,
        priority: contact.priority,
        createdAt: contact.createdAt,
      })),
      reports: userData.reports,
      sosSessions: userData.sosSessions,
      payments: userData.payments,
      exportedAt: new Date().toISOString(),
      exportFormat: format,
    };

    // Log data export
    logAuditEvent({
      actorId: user.id,
      action: 'data_exported',
      resource: 'user_data',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
      metadata: {
        format,
        includeReports,
        includeSOSSessions,
      },
    });

    if (format === 'csv') {
      // Simple CSV export (would need proper CSV library for complex data)
      const csv = `Profile\nField,Value\nID,${userData.id}\nEmail,${userData.email}\nName,"${userData.firstName} ${userData.lastName}"\nCreated,${userData.createdAt}`;
      
      reply
        .type('text/csv')
        .header('Content-Disposition', `attachment; filename="safespot-data-${user.id}.csv"`)
        .send(csv);
    } else {
      reply
        .type('application/json')
        .header('Content-Disposition', `attachment; filename="safespot-data-${user.id}.json"`)
        .send(exportData);
    }
  });

  /**
   * Delete user account (GDPR compliance)
   */
  app.delete('/account', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Delete user account (GDPR)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['password'],
        properties: {
          password: { type: 'string' },
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { password, reason } = request.body as { password: string; reason?: string };

    // Verify password
    const currentUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    if (!currentUser?.passwordHash) {
      throw app.httpErrors.badRequest('Password verification required');
    }

    const isPasswordValid = await verifyPassword(password, currentUser.passwordHash);
    if (!isPasswordValid) {
      throw app.httpErrors.badRequest('Invalid password');
    }

    // Anonymize user data instead of hard delete (for referential integrity)
    const anonymizedData = anonymizeData({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        email: anonymizedData.email,
        firstName: anonymizedData.firstName,
        lastName: anonymizedData.lastName,
        phone: anonymizedData.phone,
        passwordHash: null,
        isActive: false,
        deletedAt: new Date(),
        gdprConsent: null,
      },
    });

    // Deactivate all contacts
    await prisma.userContact.updateMany({
      where: { userId: user.id },
      data: { isActive: false },
    });

    // End any active SOS sessions
    await prisma.sOSSession.updateMany({
      where: { 
        userId: user.id,
        state: 'ACTIVE',
      },
      data: { 
        state: 'CANCELLED',
        endedAt: new Date(),
      },
    });

    // Log account deletion
    logAuditEvent({
      actorId: user.id,
      action: 'account_deleted',
      resource: 'user',
      resourceId: user.id,
      success: true,
      ipAddress: request.ip,
      metadata: {
        reason: reason || 'User requested deletion',
        gdprCompliance: true,
      },
    });

    reply.send({
      message: 'Account deleted successfully',
      note: 'Your data has been anonymized in compliance with GDPR regulations',
    });
  });

  /**
   * Get user statistics
   */
  app.get('/stats', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['Users'],
      summary: 'Get user statistics',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;

    const [
      reportCount,
      sosSessionCount,
      contactCount,
      recentReports,
      recentSOSSessions,
    ] = await Promise.all([
      prisma.report.count({
        where: { userId: user.id, deletedAt: null },
      }),
      prisma.sOSSession.count({
        where: { userId: user.id },
      }),
      prisma.userContact.count({
        where: { userId: user.id, isActive: true },
      }),
      prisma.report.count({
        where: {
          userId: user.id,
          deletedAt: null,
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
        },
      }),
      prisma.sOSSession.count({
        where: {
          userId: user.id,
          startedAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
        },
      }),
    ]);

    reply.send({
      reports: {
        total: reportCount,
        recent: recentReports,
      },
      sosSessions: {
        total: sosSessionCount,
        recent: recentSOSSessions,
      },
      contacts: {
        total: contactCount,
        limit: user.isPremium ? 50 : 5,
      },
      accountAge: {
        days: Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
      },
      premiumStatus: {
        isActive: user.isPremium,
        // Add more premium status details if needed
      },
    });
  });
}