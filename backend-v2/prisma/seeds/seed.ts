/*
  SafeSpot Sentinel Global V2 - Prisma Seed Script
  Creates baseline data for development (admin user, test user, preferences)
*/

import { PrismaClient, Role, Theme, Plan, PaymentProvider, PaymentStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { encrypt } from '../../src/security/encryption.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding SafeSpot Sentinel Global V2...');

  // Admin user
  const adminEmail = 'admin@safespot.local';
  const adminPassword = 'Admin123!@#';

  const adminHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: adminHash,
      firstName: 'SafeSpot',
      lastName: 'Admin',
      role: Role.ADMIN,
      isActive: true,
      emailVerified: true,
      preferences: {
        create: {
          alertRadiusM: 2000,
          categories: { crime: true, weather: true, transport: true, fire: true, flood: true },
          theme: Theme.DARK,
          pushEnabled: true,
          emailEnabled: true,
        },
      },
    },
  });

  // Regular user
  const userEmail = 'user@safespot.local';
  const userPassword = 'User123!@#';
  const userHash = await bcrypt.hash(userPassword, 12);

  const encPhone = await encrypt('+33123456789');
  const user = await prisma.user.upsert({
    where: { email: userEmail },
    update: {},
    create: {
      email: userEmail,
      passwordHash: userHash,
      firstName: 'Ava',
      lastName: 'Martin',
      role: Role.USER,
      isActive: true,
      emailVerified: true,
      preferences: {
        create: {
          alertRadiusM: 2000,
          categories: { crime: true, weather: true, transport: true },
          theme: Theme.LIGHT,
          pushEnabled: true,
          emailEnabled: true,
        },
      },
    },
  });

  // Add one contact for user
  await prisma.userContact.upsert({
    where: { id: 'seed-user-contact-1' },
    update: {},
    create: {
      id: 'seed-user-contact-1',
      userId: user.id,
      type: 'EMAIL',
      value: await encrypt('contact@example.com'),
      label: 'Parent',
      relationship: 'Family',
      priority: 1,
      verified: true,
    },
  });

  // Example report
  await prisma.report.create({
    data: {
      userId: user.id,
      type: 'WEATHER',
      title: 'Fortes rafales de vent',
      description: 'Vents très forts dans le centre-ville, prudence recommandée pour les piétons.',
      latitude: 48.8566,
      longitude: 2.3522,
      address: 'Paris, FR',
      mediaUrls: [],
      status: 'VALIDATED',
      trustScore: 80,
      aiModeration: {
        isAppropriate: true,
        trustScore: 80,
        reason: 'High-quality report with sufficient details',
        categories: ['weather'],
        timestamp: new Date().toISOString(),
        version: 'seed-1.0',
      },
    },
  });

  // Example payment record (inactive)
  await prisma.payment.create({
    data: {
      userId: user.id,
      provider: PaymentProvider.STRIPE,
      plan: Plan.PREMIUM_MONTHLY,
      amount: 9.99,
      currency: 'EUR',
      status: PaymentStatus.PENDING,
    },
  });

  console.log('✅ Seed completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });