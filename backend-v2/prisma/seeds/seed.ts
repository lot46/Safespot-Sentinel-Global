/**
 * SafeSpot Sentinel Global V2 - Database Seed
 * Populate database with initial data for development and testing
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/security/encryption.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // 1. Create system configuration
  await prisma.systemConfig.upsert({
    where: { key: 'app_version' },
    update: { value: '2.0.0' },
    create: {
      key: 'app_version',
      value: '2.0.0',
      description: 'Current application version',
      isPublic: true,
    },
  });

  await prisma.systemConfig.upsert({
    where: { key: 'maintenance_mode' },
    update: { value: false },
    create: {
      key: 'maintenance_mode',
      value: false,
      description: 'System maintenance mode flag',
      isPublic: false,
    },
  });

  // 2. Create test users
  const adminPassword = await hashPassword('admin123');
  const userPassword = await hashPassword('user123');

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@safespot.com' },
    update: {},
    create: {
      email: 'admin@safespot.com',
      passwordHash: adminPassword,
      firstName: 'Admin',
      lastName: 'SafeSpot',
      role: 'ADMIN',
      emailVerified: true,
      isActive: true,
      gdprConsent: {
        functional: true,
        analytics: true,
        marketing: false,
        timestamp: new Date().toISOString(),
      },
      preferences: {
        create: {
          alertRadiusM: 10000,
          categories: {
            crime: true,
            weather: true,
            transport: true,
            fire: true,
            flood: true,
            harassment: true,
            robbery: true,
            other: true,
          },
          theme: 'DARK',
          pushEnabled: true,
          emailEnabled: true,
          smsEnabled: false,
        },
      },
    },
  });

  const moderatorUser = await prisma.user.upsert({
    where: { email: 'moderator@safespot.com' },
    update: {},
    create: {
      email: 'moderator@safespot.com',
      passwordHash: userPassword,
      firstName: 'Moderator',
      lastName: 'SafeSpot',
      role: 'MODERATOR',
      emailVerified: true,
      isActive: true,
      gdprConsent: {
        functional: true,
        analytics: true,
        marketing: false,
        timestamp: new Date().toISOString(),
      },
      preferences: {
        create: {
          alertRadiusM: 5000,
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
  });

  const testUser = await prisma.user.upsert({
    where: { email: 'test@safespot.com' },
    update: {},
    create: {
      email: 'test@safespot.com',
      passwordHash: userPassword,
      firstName: 'Test',
      lastName: 'User',
      phone: '+33123456789',
      role: 'USER',
      emailVerified: true,
      phoneVerified: true,
      isActive: true,
      isPremium: true,
      premiumUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
      gdprConsent: {
        functional: true,
        analytics: true,
        marketing: true,
        timestamp: new Date().toISOString(),
      },
      preferences: {
        create: {
          alertRadiusM: 20000, // Premium user
          categories: {
            crime: true,
            weather: true,
            transport: true,
            fire: true,
            flood: true,
            harassment: true,
            robbery: true,
            other: true,
          },
          theme: 'AUTO',
          sosMessage: 'URGENT - J\'ai besoin d\'aide immédiatement ! Contactez-moi ou appelez les secours.',
          pushEnabled: true,
          emailEnabled: true,
          smsEnabled: true,
          locationSharing: true,
        },
      },
    },
  });

  // 3. Create emergency contacts for test user
  await prisma.userContact.createMany({
    data: [
      {
        userId: testUser.id,
        type: 'EMAIL',
        value: 'emergency1@example.com',
        label: 'Papa',
        relationship: 'family',
        priority: 1,
        verified: true,
      },
      {
        userId: testUser.id,
        type: 'SMS',
        value: '+33987654321',
        label: 'Maman',
        relationship: 'family',
        priority: 2,
        verified: true,
      },
      {
        userId: testUser.id,
        type: 'EMAIL',
        value: 'friend@example.com',
        label: 'Meilleur ami',
        relationship: 'friend',
        priority: 3,
        verified: false,
      },
    ],
    skipDuplicates: true,
  });

  // 4. Create sample reports
  const sampleReports = [
    {
      userId: testUser.id,
      type: 'CRIME',
      title: 'Vol de vélo suspect',
      description: 'J\'ai vu quelqu\'un forcer un antivol de vélo devant la gare. La personne portait un hoodie noir et avait des outils. Le vélo était un VTT rouge.',
      latitude: 48.8566,
      longitude: 2.3522,
      address: 'Gare du Nord, Paris',
      status: 'VALIDATED',
      trustScore: 85,
      geom: 'POINT(2.3522 48.8566)',
    },
    {
      userId: testUser.id,
      type: 'TRANSPORT',
      title: 'Accident de circulation',
      description: 'Collision entre deux voitures au carrefour. Les voies sont bloquées, circulation très ralentie. Pompiers sur place.',
      latitude: 48.8606,
      longitude: 2.3376,
      address: 'Place de la République, Paris',
      status: 'VALIDATED',
      trustScore: 92,
      geom: 'POINT(2.3376 48.8606)',
    },
    {
      userId: moderatorUser.id,
      type: 'WEATHER',
      title: 'Inondation après orage',
      description: 'Forte accumulation d\'eau dans le passage souterrain. Niveau d\'eau jusqu\'aux genoux, passage impraticable.',
      latitude: 48.8738,
      longitude: 2.2950,
      address: 'Châtelet-Les Halles, Paris',
      status: 'VALIDATED',
      trustScore: 88,
      geom: 'POINT(2.2950 48.8738)',
    },
    {
      userId: adminUser.id,
      type: 'FIRE',
      title: 'Début d\'incendie dans un immeuble',
      description: 'Fumée visible au 3ème étage. Pompiers appelés. Évacuation en cours des résidents.',
      latitude: 48.8534,
      longitude: 2.3486,
      address: 'Île Saint-Louis, Paris',
      status: 'VALIDATED',
      trustScore: 95,
      geom: 'POINT(2.3486 48.8534)',
    },
    {
      userId: testUser.id,
      type: 'HARASSMENT',
      title: 'Harcèlement dans le métro',
      description: 'Homme suivant et importunant des femmes dans la rame. Description: environ 40 ans, veste en cuir marron, casquette bleue.',
      latitude: 48.8442,
      longitude: 2.3371,
      address: 'Station Saint-Michel, Paris',
      status: 'PENDING',
      trustScore: 70,
      geom: 'POINT(2.3371 48.8442)',
    },
  ];

  for (const report of sampleReports) {
    await prisma.report.upsert({
      where: { 
        // Use a composite key approach or create unique constraint
        id: `seed_${report.type}_${report.latitude}_${report.longitude}`.replace(/[^\w]/g, '_'),
      },
      update: {},
      create: {
        id: `seed_${report.type}_${report.latitude}_${report.longitude}`.replace(/[^\w]/g, '_'),
        ...report,
        aiModeration: {
          isAppropriate: true,
          trustScore: report.trustScore,
          reason: 'Seed data - pre-validated',
          categories: [report.type.toLowerCase()],
          timestamp: new Date().toISOString(),
          version: '1.0',
        },
      },
    });
  }

  // 5. Create safety zones
  const safetyZones = [
    {
      name: 'Zone Sécurisée Centre-Ville',
      level: 'GREEN',
      source: 'OFFICIAL',
      description: 'Zone avec forte présence policière et éclairage optimal',
      geom: 'POLYGON((2.3350 48.8550, 2.3450 48.8550, 2.3450 48.8650, 2.3350 48.8650, 2.3350 48.8550))',
      area: 1000000, // ~1 km²
      validFrom: new Date(),
      validTo: null,
      sourceId: 'POLICE_ZONE_001',
      sourceData: {
        authority: 'Préfecture de Police de Paris',
        patrols: 'regular',
        lighting: 'optimal',
        cameras: 'high_density',
      },
    },
    {
      name: 'Zone de Vigilance - Quartier Sensible',
      level: 'ORANGE',
      source: 'COMMUNITY',
      description: 'Signalements récurrents d\'incidents mineurs, vigilance recommandée',
      geom: 'POLYGON((2.3600 48.8400, 2.3700 48.8400, 2.3700 48.8500, 2.3600 48.8500, 2.3600 48.8400))',
      area: 1000000,
      validFrom: new Date(),
      validTo: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      sourceId: 'COMMUNITY_ZONE_001',
      sourceData: {
        reportCount: 15,
        averageTrustScore: 75,
        lastIncident: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    },
    {
      name: 'Zone Dangereuse - Éviter',
      level: 'RED',
      source: 'AI',
      description: 'Concentration élevée d\'incidents graves, éviter si possible',
      geom: 'POLYGON((2.3800 48.8300, 2.3850 48.8300, 2.3850 48.8350, 2.3800 48.8350, 2.3800 48.8300))',
      area: 250000, // ~0.25 km²
      validFrom: new Date(),
      validTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      sourceId: 'AI_ANALYSIS_001',
      sourceData: {
        algorithm: 'incident_clustering_v2',
        confidence: 0.87,
        incidents: 8,
        severity: 'high',
        recommendation: 'avoid_during_night_hours',
      },
    },
    {
      name: 'Alerte Météo - Risque d\'Inondation',
      level: 'ORANGE',
      source: 'WEATHER',
      description: 'Risque d\'inondation suite aux fortes pluies prévues',
      geom: 'POLYGON((2.3200 48.8600, 2.3300 48.8600, 2.3300 48.8650, 2.3200 48.8650, 2.3200 48.8600))',
      area: 500000,
      validFrom: new Date(),
      validTo: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 hours
      sourceId: 'METEO_FRANCE_001',
      sourceData: {
        provider: 'Météo-France',
        alertType: 'flood_risk',
        severity: 'moderate',
        rainfall: '50mm/h',
        duration: '6h',
      },
    },
  ];

  for (const zone of safetyZones) {
    await prisma.zone.upsert({
      where: { 
        sourceId: zone.sourceId || `zone_${zone.name.replace(/\s+/g, '_').toLowerCase()}`,
      },
      update: {},
      create: {
        ...zone,
        sourceId: zone.sourceId || `zone_${zone.name.replace(/\s+/g, '_').toLowerCase()}`,
      },
    });
  }

  // 6. Create sample payments for premium user
  await prisma.payment.upsert({
    where: { 
      id: 'seed_payment_premium_yearly',
    },
    update: {},
    create: {
      id: 'seed_payment_premium_yearly',
      userId: testUser.id,
      plan: 'PREMIUM_YEARLY',
      provider: 'STRIPE',
      externalId: 'sub_seed_premium_yearly',
      customerId: 'cus_seed_test_user',
      amount: 99.99,
      currency: 'EUR',
      status: 'ACTIVE',
      startedAt: new Date(),
      renewsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      metadata: {
        source: 'seed_data',
        plan_name: 'Premium Yearly',
      },
    },
  });

  // 7. Create sample security events
  await prisma.securityEvent.createMany({
    data: [
      {
        type: 'failed_login',
        severity: 'low',
        source: '192.168.1.100',
        description: 'Multiple failed login attempts',
        ipAddress: '192.168.1.100',
        userId: null,
        metadata: {
          attempts: 3,
          timeWindow: '5min',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        resolved: true,
        resolvedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
      {
        type: 'suspicious_activity',
        severity: 'medium',
        source: 'api_endpoint',
        description: 'Unusual API request pattern detected',
        userId: testUser.id,
        metadata: {
          endpoint: '/api/reports',
          requestCount: 50,
          timeWindow: '1min',
          pattern: 'burst_requests',
        },
        resolved: false,
      },
      {
        type: 'rate_limit_exceeded',
        severity: 'low',
        source: '10.0.0.50',
        description: 'Rate limit exceeded for WebSocket connections',
        ipAddress: '10.0.0.50',
        metadata: {
          limit: 5,
          actual: 8,
          timeWindow: '1min',
          service: 'websocket',
        },
        resolved: true,
        resolvedAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    ],
    skipDuplicates: true,
  });

  // 8. Create audit log entries
  await prisma.auditLog.createMany({
    data: [
      {
        actorId: adminUser.id,
        actorRole: 'ADMIN',
        action: 'user_created',
        resource: 'user',
        resourceId: testUser.id,
        success: true,
        metadata: {
          userEmail: testUser.email,
          creationMethod: 'admin_panel',
        },
      },
      {
        actorId: testUser.id,
        actorRole: 'USER',
        action: 'report_created',
        resource: 'report',
        resourceId: 'seed_CRIME_48_8566_2_3522',
        success: true,
        metadata: {
          reportType: 'CRIME',
          location: { latitude: 48.8566, longitude: 2.3522 },
        },
      },
      {
        actorId: moderatorUser.id,
        actorRole: 'MODERATOR',
        action: 'report_approved',
        resource: 'report',
        resourceId: 'seed_HARASSMENT_48_8442_2_3371',
        success: true,
        metadata: {
          previousStatus: 'PENDING',
          newStatus: 'VALIDATED',
          moderationReason: 'Content verified and appropriate',
        },
      },
    ],
    skipDuplicates: true,
  });

  console.log('✅ Database seed completed successfully!');
  console.log('\n📊 Seed Summary:');
  console.log('👥 Users created: 3 (1 admin, 1 moderator, 1 premium user)');
  console.log('📞 Emergency contacts: 3');
  console.log('📍 Sample reports: 5');
  console.log('🗺️ Safety zones: 4');
  console.log('💳 Payment records: 1');
  console.log('🔒 Security events: 3');
  console.log('📝 Audit logs: 3');
  console.log('\n🔑 Test Credentials:');
  console.log('Admin: admin@safespot.com / admin123');
  console.log('Moderator: moderator@safespot.com / user123');
  console.log('Premium User: test@safespot.com / user123');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });