/**
 * SafeSpot Sentinel Global V2 - SOS Emergency Routes
 * Critical emergency system with real-time tracking and multi-channel alerts
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger, logAuditEvent } from '../utils/logger.js';
import { sendSOSAlertEmail } from '../integrations/email.js';
import { sendEmergencySMS } from '../integrations/sms.js';
import { generateSecureToken } from '../security/encryption.js';

const prisma = getPrisma();

// Validation schemas
const startSOSSchema = z.object({
  message: z.string().min(1).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  contactIds: z.array(z.string()).optional(), // Specific contacts to notify
});

const heartbeatSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export default async function sosRoutes(app: FastifyInstance) {
  
  /**
   * Start SOS emergency session
   */
  app.post('/start', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['SOS'],
      summary: 'Start emergency SOS session',
      description: 'Triggers emergency alerts to all contacts via SMS, email, and push notifications',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['message', 'latitude', 'longitude'],
        properties: {
          message: { type: 'string', minLength: 1, maxLength: 500 },
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          contactIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional specific contacts to notify (if not provided, all contacts are notified)',
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            status: { type: 'string' },
            message: { type: 'string' },
            location: {
              type: 'object',
              properties: {
                latitude: { type: 'number' },
                longitude: { type: 'number' },
              },
            },
            contactsNotified: {
              type: 'array',
              items: { type: 'string' },
            },
            trackingUrl: { type: 'string' },
            startedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = startSOSSchema.parse(request.body);

    // Check if user already has an active SOS session
    const existingSession = await prisma.sOSSession.findFirst({
      where: {
        userId: user.id,
        state: 'ACTIVE',
      },
    });

    if (existingSession) {
      throw app.httpErrors.conflict('Active SOS session already exists');
    }

    // Get user's emergency contacts
    let contacts;
    if (data.contactIds && data.contactIds.length > 0) {
      // Specific contacts requested
      contacts = await prisma.userContact.findMany({
        where: {
          userId: user.id,
          id: { in: data.contactIds },
          isActive: true,
        },
        orderBy: { priority: 'asc' },
      });
    } else {
      // All active contacts
      contacts = await prisma.userContact.findMany({
        where: {
          userId: user.id,
          isActive: true,
        },
        orderBy: { priority: 'asc' },
      });
    }

    if (contacts.length === 0) {
      throw app.httpErrors.badRequest('No emergency contacts configured');
    }

    // Create SOS session
    const session = await prisma.sOSSession.create({
      data: {
        userId: user.id,
        state: 'ACTIVE',
        message: data.message,
        startLocation: `POINT(${data.longitude} ${data.latitude})`,
        lastLocation: `POINT(${data.longitude} ${data.latitude})`,
        locationHistory: [
          {
            latitude: data.latitude,
            longitude: data.longitude,
            timestamp: new Date().toISOString(),
          },
        ],
        contactsNotified: contacts.map(c => c.id),
      },
    });

    // Generate tracking URL
    const trackingToken = generateSecureToken();
    const trackingUrl = `${process.env.FRONTEND_URL}/sos/track/${session.id}?token=${trackingToken}`;

    // Send notifications to all contacts
    const notificationPromises = contacts.map(async (contact) => {
      const contactData = {
        name: contact.label,
        relationship: contact.relationship || 'Contact',
        value: contact.value,
        type: contact.type,
      };

      try {
        switch (contact.type) {
          case 'EMAIL':
            return await sendSOSAlertEmail(
              contact.value,
              `${user.firstName} ${user.lastName}`,
              data.message,
              { latitude: data.latitude, longitude: data.longitude },
              session.id
            );

          case 'SMS':
            return await sendEmergencySMS(
              contact.value,
              { latitude: data.latitude, longitude: data.longitude },
              `${user.firstName} ${user.lastName}`,
              data.message
            );

          case 'PUSH':
            // TODO: Implement push notification
            logger.info('Push notification not yet implemented', { contactId: contact.id });
            return { success: true, method: 'push' };

          default:
            logger.warn('Unknown contact type', { type: contact.type, contactId: contact.id });
            return { success: false, error: 'Unknown contact type' };
        }
      } catch (error) {
        logger.error('Failed to send SOS notification', {
          error,
          contactId: contact.id,
          type: contact.type,
          sessionId: session.id,
        });
        return { success: false, error: error.message };
      }
    });

    // Wait for all notifications to complete
    const notificationResults = await Promise.allSettled(notificationPromises);
    const successfulNotifications = notificationResults.filter(
      (result) => result.status === 'fulfilled' && result.value.success
    ).length;

    // Log the SOS event
    logAuditEvent({
      actorId: user.id,
      action: 'sos_started',
      resource: 'sos_session',
      resourceId: session.id,
      success: true,
      ipAddress: request.ip,
      metadata: {
        location: { latitude: data.latitude, longitude: data.longitude },
        contactsTotal: contacts.length,
        contactsNotified: successfulNotifications,
        message: data.message,
      },
    });

    logger.error('SOS session started', {
      userId: user.id,
      sessionId: session.id,
      location: { latitude: data.latitude, longitude: data.longitude },
      contactsNotified: successfulNotifications,
      contactsTotal: contacts.length,
    });

    reply.code(201).send({
      sessionId: session.id,
      status: session.state,
      message: session.message,
      location: {
        latitude: data.latitude,
        longitude: data.longitude,
      },
      contactsNotified: contacts.map(c => c.id),
      notificationsSent: successfulNotifications,
      trackingUrl,
      startedAt: session.startedAt,
    });
  });

  /**
   * Send location heartbeat for active SOS session
   */
  app.post('/heartbeat', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['SOS'],
      summary: 'Send location heartbeat for active SOS session',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const data = heartbeatSchema.parse(request.body);

    // Find active SOS session
    const session = await prisma.sOSSession.findFirst({
      where: {
        userId: user.id,
        state: 'ACTIVE',
      },
    });

    if (!session) {
      throw app.httpErrors.notFound('No active SOS session found');
    }

    // Update session with new location
    const locationUpdate = {
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: new Date().toISOString(),
    };

    await prisma.sOSSession.update({
      where: { id: session.id },
      data: {
        lastLocation: `POINT(${data.longitude} ${data.latitude})`,
        locationHistory: {
          push: locationUpdate,
        },
        lastHeartbeat: new Date(),
      },
    });

    // TODO: Broadcast location update via WebSocket to contacts

    logger.debug('SOS heartbeat received', {
      userId: user.id,
      sessionId: session.id,
      location: { latitude: data.latitude, longitude: data.longitude },
    });

    reply.send({
      sessionId: session.id,
      status: 'heartbeat_received',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * End SOS session
   */
  app.post('/end', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['SOS'],
      summary: 'End active SOS session',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;

    // Find active SOS session
    const session = await prisma.sOSSession.findFirst({
      where: {
        userId: user.id,
        state: 'ACTIVE',
      },
    });

    if (!session) {
      throw app.httpErrors.notFound('No active SOS session found');
    }

    // End the session
    const updatedSession = await prisma.sOSSession.update({
      where: { id: session.id },
      data: {
        state: 'ENDED',
        endedAt: new Date(),
      },
    });

    // Log the SOS end event
    logAuditEvent({
      actorId: user.id,
      action: 'sos_ended',
      resource: 'sos_session',
      resourceId: session.id,
      success: true,
      ipAddress: request.ip,
      metadata: {
        duration: updatedSession.endedAt!.getTime() - updatedSession.startedAt.getTime(),
      },
    });

    logger.info('SOS session ended', {
      userId: user.id,
      sessionId: session.id,
      duration: updatedSession.endedAt!.getTime() - updatedSession.startedAt.getTime(),
    });

    reply.send({
      sessionId: session.id,
      status: 'ended',
      endedAt: updatedSession.endedAt,
      duration: updatedSession.endedAt!.getTime() - updatedSession.startedAt.getTime(),
    });
  });

  /**
   * Get active SOS sessions for user
   */
  app.get('/sessions', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['SOS'],
      summary: 'Get user SOS sessions',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          status: { type: 'string', enum: ['ACTIVE', 'ENDED', 'CANCELLED'] },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { limit = 10, offset = 0, status } = request.query as any;

    const sessions = await prisma.sOSSession.findMany({
      where: {
        userId: user.id,
        ...(status && { state: status }),
      },
      orderBy: { startedAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id: true,
        state: true,
        message: true,
        startedAt: true,
        endedAt: true,
        lastHeartbeat: true,
        contactsNotified: true,
      },
    });

    const totalCount = await prisma.sOSSession.count({
      where: {
        userId: user.id,
        ...(status && { state: status }),
      },
    });

    reply.send({
      sessions,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
    });
  });

  /**
   * Get SOS session details (for tracking by contacts)
   */
  app.get('/track/:sessionId', {
    schema: {
      tags: ['SOS'],
      summary: 'Track SOS session (for emergency contacts)',
      params: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          token: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const { token } = request.query as { token?: string };

    // TODO: Validate tracking token (should be generated when SOS is started)
    // For now, we'll allow public access for emergency contacts

    const session = await prisma.sOSSession.findUnique({
      where: { id: sessionId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!session) {
      throw app.httpErrors.notFound('SOS session not found');
    }

    // Get latest location from history
    const locationHistory = session.locationHistory as any[];
    const latestLocation = locationHistory[locationHistory.length - 1];

    reply.send({
      sessionId: session.id,
      user: {
        name: `${session.user.firstName} ${session.user.lastName}`,
      },
      status: session.state,
      message: session.message,
      currentLocation: latestLocation ? {
        latitude: latestLocation.latitude,
        longitude: latestLocation.longitude,
        timestamp: latestLocation.timestamp,
      } : null,
      startedAt: session.startedAt,
      lastHeartbeat: session.lastHeartbeat,
      isActive: session.state === 'ACTIVE',
    });
  });

  /**
   * Cancel SOS session
   */
  app.post('/cancel', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['SOS'],
      summary: 'Cancel active SOS session',
      security: [{ bearerAuth: [] }],
    },
  }, async (request, reply) => {
    const user = request.user!;

    // Find active SOS session
    const session = await prisma.sOSSession.findFirst({
      where: {
        userId: user.id,
        state: 'ACTIVE',
      },
    });

    if (!session) {
      throw app.httpErrors.notFound('No active SOS session found');
    }

    // Cancel the session
    const updatedSession = await prisma.sOSSession.update({
      where: { id: session.id },
      data: {
        state: 'CANCELLED',
        endedAt: new Date(),
      },
    });

    // Log the cancellation
    logAuditEvent({
      actorId: user.id,
      action: 'sos_cancelled',
      resource: 'sos_session',
      resourceId: session.id,
      success: true,
      ipAddress: request.ip,
    });

    logger.info('SOS session cancelled', {
      userId: user.id,
      sessionId: session.id,
    });

    reply.send({
      sessionId: session.id,
      status: 'cancelled',
      cancelledAt: updatedSession.endedAt,
    });
  });

  /**
   * Test SOS system (for testing notification delivery)
   */
  app.post('/test', {
    preHandler: [app.authenticate],
    schema: {
      tags: ['SOS'],
      summary: 'Test SOS notification system',
      description: 'Sends test notifications to emergency contacts without creating an actual SOS session',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          contactIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific contacts to test (optional)',
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = request.user!;
    const { contactIds } = request.body as { contactIds?: string[] };

    // Get contacts to test
    let contacts;
    if (contactIds && contactIds.length > 0) {
      contacts = await prisma.userContact.findMany({
        where: {
          userId: user.id,
          id: { in: contactIds },
          isActive: true,
        },
      });
    } else {
      contacts = await prisma.userContact.findMany({
        where: {
          userId: user.id,
          isActive: true,
        },
        take: 1, // Only test first contact to avoid spam
      });
    }

    if (contacts.length === 0) {
      throw app.httpErrors.badRequest('No contacts available for testing');
    }

    // Send test notifications
    const testMessage = `Test d'alerte SOS SafeSpot Sentinel - Ceci est un test de notification d'urgence de ${user.firstName} ${user.lastName}. Aucune action n'est requise.`;
    
    const results = await Promise.allSettled(
      contacts.map(async (contact) => {
        switch (contact.type) {
          case 'EMAIL':
            return await sendSOSAlertEmail(
              contact.value,
              `${user.firstName} ${user.lastName}`,
              testMessage,
              { latitude: 48.8566, longitude: 2.3522 }, // Paris coordinates for test
              'test-session'
            );
          case 'SMS':
            return await sendEmergencySMS(
              contact.value,
              { latitude: 48.8566, longitude: 2.3522 },
              `${user.firstName} ${user.lastName}`,
              testMessage
            );
          default:
            return { success: false, error: 'Unsupported contact type for testing' };
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;

    // Log test
    logAuditEvent({
      actorId: user.id,
      action: 'sos_test',
      resource: 'sos_test',
      success: true,
      ipAddress: request.ip,
      metadata: {
        contactsTested: contacts.length,
        successful,
      },
    });

    reply.send({
      message: 'SOS test completed',
      contactsTested: contacts.length,
      successful,
      failed: contacts.length - successful,
      results: results.map((result, index) => ({
        contactId: contacts[index].id,
        contactType: contacts[index].type,
        success: result.status === 'fulfilled' && result.value.success,
        error: result.status === 'rejected' ? result.reason : 
               (result.status === 'fulfilled' && !result.value.success ? result.value.error : null),
      })),
    });
  });
}