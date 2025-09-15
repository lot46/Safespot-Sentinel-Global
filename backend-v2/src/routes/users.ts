/**
 * SafeSpot Sentinel Global V2 - User Management Routes (with encryption-at-rest)
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger, logAuditEvent } from '../utils/logger.js';
import { hashPassword, verifyPassword, anonymizeData, encrypt, decrypt, normalizePhone, hashForSearch } from '../security/encryption.js';

const prisma = getPrisma();

const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().optional(),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(50).optional(),
});

const addContactSchema = z.object({
  type: z.enum(['EMAIL', 'SMS', 'PUSH']),
  value: z.string().min(1).max(255),
  label: z.string().min(1).max(100),
  relationship: z.string().max(50).optional(),
  priority: z.number().min(1).max(10).default(1),
});

export default async function userRoutes(app: FastifyInstance) {
  /** Update user profile (encrypt phone at rest) */
  app.patch('/profile', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    const data = updateProfileSchema.parse(request.body);

    // Phone uniqueness via phoneSearchHash
    let phoneEncrypted: string | undefined;
    let phoneSearchHash: string | undefined;
    if (data.phone) {
      const normalized = normalizePhone(data.phone);
      phoneEncrypted = await encrypt(data.phone);
      phoneSearchHash = hashForSearch(normalized);

      const existing = await prisma.user.findFirst({ where: { phoneSearchHash, id: { not: user.id } } });
      if (existing) {
        throw app.httpErrors.conflict('Phone number already in use');
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        ...(data.phone !== undefined ? { phone: phoneEncrypted || null, phoneSearchHash: phoneSearchHash || null, phoneVerified: false } : {}),
        locale: data.locale,
        timezone: data.timezone,
        updatedAt: new Date(),
      },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, phoneVerified: true, locale: true, timezone: true, updatedAt: true },
    });

    let phonePlain: string | null = null;
    if (updated.phone) {
      try { phonePlain = await decrypt(updated.phone); } catch {}
    }

    logAuditEvent({ actorId: user.id, action: 'profile_updated', resource: 'user', resourceId: user.id, success: true, ipAddress: request.ip, metadata: { fieldsUpdated: Object.keys(data) } });

    reply.send({ ...updated, phone: phonePlain });
  });

  /** Add emergency contact (encrypt at rest) */
  app.post('/contacts', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    const data = addContactSchema.parse(request.body);

    // Check limits (basic)
    const count = await prisma.userContact.count({ where: { userId: user.id, isActive: true } });
    const maxContacts = user.isPremium ? 50 : 5;
    if (count >= maxContacts) {
      throw app.httpErrors.paymentRequired('Contact limit reached');
    }

    // Encrypt and hash
    const encryptedValue = await encrypt(data.value);
    const valueHash = hashForSearch(data.value.trim().toLowerCase());

    // Prevent duplicates
    const existing = await prisma.userContact.findFirst({ where: { userId: user.id, type: data.type, valueHash, isActive: true } });
    if (existing) {
      throw app.httpErrors.conflict('Contact already exists');
    }

    const contact = await prisma.userContact.create({
      data: { userId: user.id, type: data.type as any, value: encryptedValue, valueHash, label: data.label, relationship: data.relationship, priority: data.priority },
    });

    logAuditEvent({ actorId: user.id, action: 'contact_added', resource: 'user_contact', resourceId: contact.id, success: true, ipAddress: request.ip, metadata: { type: data.type, label: data.label } });

    reply.code(201).send({ ...contact, value: data.value });
  });

  /** Get contacts (decrypt values) */
  app.get('/contacts', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    const contacts = await prisma.userContact.findMany({ where: { userId: user.id, isActive: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
    const decrypted = await Promise.all(contacts.map(async (c) => ({ ...c, value: c.value ? await decrypt(c.value).catch(() => null) : null })));
    reply.send(decrypted);
  });
}