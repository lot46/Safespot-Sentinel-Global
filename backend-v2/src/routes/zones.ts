/**
 * SafeSpot Sentinel Global V2 - Geographic Zones Routes
 * PostGIS-powered geospatial queries for safety zones
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrisma } from '../database/index.js';
import { logger } from '../utils/logger.js';

const prisma = getPrisma();

// Validation schemas
const bboxSchema = z.object({
  bbox: z.string().regex(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/),
  level: z.enum(['GREEN', 'ORANGE', 'RED']).optional(),
  source: z.enum(['COMMUNITY', 'OFFICIAL', 'AI', 'WEATHER']).optional(),
  limit: z.number().min(1).max(500).default(100),
});

const nearbySchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius: z.number().min(100).max(50000).default(5000), // meters
  level: z.enum(['GREEN', 'ORANGE', 'RED']).optional(),
});

export default async function zonesRoutes(app: FastifyInstance) {

  /**
   * Get zones within bounding box
   */
  app.get('/', {
    schema: {
      tags: ['Zones'],
      summary: 'Get safety zones within bounding box',
      description: 'Retrieve safety zones using PostGIS spatial queries',
      querystring: {
        type: 'object',
        required: ['bbox'],
        properties: {
          bbox: {
            type: 'string',
            description: 'Bounding box as "lat1,lon1,lat2,lon2"',
            pattern: '^-?\\d+\\.?\\d*,-?\\d+\\.?\\d*,-?\\d+\\.?\\d*,-?\\d+\\.?\\d*$',
          },
          level: {
            type: 'string',
            enum: ['GREEN', 'ORANGE', 'RED'],
            description: 'Filter by safety level',
          },
          source: {
            type: 'string',
            enum: ['COMMUNITY', 'OFFICIAL', 'AI', 'WEATHER'],
            description: 'Filter by zone source',
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 500,
            default: 100,
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            zones: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  level: { type: 'string' },
                  source: { type: 'string' },
                  description: { type: 'string' },
                  area: { type: 'number' },
                  validFrom: { type: 'string', format: 'date-time' },
                  validTo: { type: 'string', format: 'date-time' },
                  geometry: { type: 'object' },
                },
              },
            },
            count: { type: 'number' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const query = bboxSchema.parse(request.query);
    const [lat1, lon1, lat2, lon2] = query.bbox.split(',').map(Number);

    // Build where clause
    const whereClause: any = {
      isActive: true,
      validFrom: { lte: new Date() },
      OR: [
        { validTo: null },
        { validTo: { gte: new Date() } },
      ],
    };

    if (query.level) {
      whereClause.level = query.level;
    }

    if (query.source) {
      whereClause.source = query.source;
    }

    try {
      // Use raw SQL for PostGIS spatial query
      const zones = await prisma.$queryRaw`
        SELECT 
          id,
          name,
          level,
          source,
          description,
          area,
          valid_from as "validFrom",
          valid_to as "validTo",
          ST_AsGeoJSON(geom) as geometry,
          created_at as "createdAt"
        FROM zones 
        WHERE 
          is_active = true
          AND valid_from <= NOW()
          AND (valid_to IS NULL OR valid_to >= NOW())
          AND ST_Intersects(
            geom, 
            ST_MakeEnvelope(${lon1}, ${lat1}, ${lon2}, ${lat2}, 4326)
          )
          ${query.level ? prisma.$queryRaw`AND level = ${query.level}` : prisma.$queryRaw``}
          ${query.source ? prisma.$queryRaw`AND source = ${query.source}` : prisma.$queryRaw``}
        ORDER BY area DESC
        LIMIT ${query.limit}
      `;

      // Parse geometry JSON
      const processedZones = (zones as any[]).map(zone => ({
        ...zone,
        geometry: zone.geometry ? JSON.parse(zone.geometry) : null,
      }));

      reply.send({
        zones: processedZones,
        count: processedZones.length,
      });

    } catch (error) {
      logger.error('PostGIS zones query failed:', error);
      throw app.httpErrors.internalServerError('Spatial query failed');
    }
  });

  /**
   * Get zones near a specific point
   */
  app.get('/nearby', {
    schema: {
      tags: ['Zones'],
      summary: 'Get safety zones near a point',
      description: 'Find zones within specified radius of a coordinate',
      querystring: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          radius: {
            type: 'number',
            minimum: 100,
            maximum: 50000,
            default: 5000,
            description: 'Search radius in meters',
          },
          level: {
            type: 'string',
            enum: ['GREEN', 'ORANGE', 'RED'],
          },
        },
      },
    },
  }, async (request, reply) => {
    const query = nearbySchema.parse(request.query);

    try {
      // Use PostGIS ST_DWithin for efficient proximity search
      const zones = await prisma.$queryRaw`
        SELECT 
          id,
          name,
          level,
          source,
          description,
          area,
          valid_from as "validFrom",
          valid_to as "validTo",
          ST_AsGeoJSON(geom) as geometry,
          ST_Distance(
            geom::geography, 
            ST_Point(${query.longitude}, ${query.latitude})::geography
          ) as distance
        FROM zones 
        WHERE 
          is_active = true
          AND valid_from <= NOW()
          AND (valid_to IS NULL OR valid_to >= NOW())
          AND ST_DWithin(
            geom::geography,
            ST_Point(${query.longitude}, ${query.latitude})::geography,
            ${query.radius}
          )
          ${query.level ? prisma.$queryRaw`AND level = ${query.level}` : prisma.$queryRaw``}
        ORDER BY distance ASC
        LIMIT 50
      `;

      // Process results
      const processedZones = (zones as any[]).map(zone => ({
        ...zone,
        geometry: zone.geometry ? JSON.parse(zone.geometry) : null,
        distance: Math.round(parseFloat(zone.distance)),
      }));

      reply.send({
        zones: processedZones,
        searchCenter: {
          latitude: query.latitude,
          longitude: query.longitude,
        },
        searchRadius: query.radius,
        count: processedZones.length,
      });

    } catch (error) {
      logger.error('PostGIS nearby zones query failed:', error);
      throw app.httpErrors.internalServerError('Proximity search failed');
    }
  });

  /**
   * Get zone details by ID
   */
  app.get('/:zoneId', {
    schema: {
      tags: ['Zones'],
      summary: 'Get zone details',
      params: {
        type: 'object',
        properties: {
          zoneId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { zoneId } = request.params as { zoneId: string };

    try {
      const zone = await prisma.$queryRaw`
        SELECT 
          id,
          name,
          level,
          source,
          description,
          area,
          valid_from as "validFrom",
          valid_to as "validTo",
          source_id as "sourceId",
          source_data as "sourceData",
          ST_AsGeoJSON(geom) as geometry,
          created_at as "createdAt",
          updated_at as "updatedAt"
        FROM zones 
        WHERE id = ${zoneId}
        LIMIT 1
      `;

      const zoneArray = zone as any[];
      if (zoneArray.length === 0) {
        throw app.httpErrors.notFound('Zone not found');
      }

      const zoneData = zoneArray[0];
      
      reply.send({
        ...zoneData,
        geometry: zoneData.geometry ? JSON.parse(zoneData.geometry) : null,
        sourceData: zoneData.sourceData ? zoneData.sourceData : null,
      });

    } catch (error) {
      if (error.statusCode) throw error;
      
      logger.error('Zone details query failed:', error);
      throw app.httpErrors.internalServerError('Failed to fetch zone details');
    }
  });

  /**
   * Check if point is in danger zone
   */
  app.get('/check-safety', {
    schema: {
      tags: ['Zones'],
      summary: 'Check safety level at coordinates',
      description: 'Determine the highest danger level at a specific location',
      querystring: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            safetyLevel: {
              type: 'string',
              enum: ['SAFE', 'GREEN', 'ORANGE', 'RED'],
            },
            zones: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  level: { type: 'string' },
                  source: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
            coordinate: {
              type: 'object',
              properties: {
                latitude: { type: 'number' },
                longitude: { type: 'number' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { latitude, longitude } = request.query as { latitude: number; longitude: number };

    try {
      // Find all zones containing this point
      const zones = await prisma.$queryRaw`
        SELECT 
          id,
          level,
          source,
          description,
          name
        FROM zones 
        WHERE 
          is_active = true
          AND valid_from <= NOW()
          AND (valid_to IS NULL OR valid_to >= NOW())
          AND ST_Contains(geom, ST_Point(${longitude}, ${latitude}))
        ORDER BY 
          CASE level 
            WHEN 'RED' THEN 1 
            WHEN 'ORANGE' THEN 2 
            WHEN 'GREEN' THEN 3 
            ELSE 4 
          END
      `;

      const zoneArray = zones as any[];
      
      // Determine overall safety level
      let safetyLevel = 'SAFE';
      if (zoneArray.length > 0) {
        const highestDangerZone = zoneArray[0];
        safetyLevel = highestDangerZone.level;
      }

      reply.send({
        safetyLevel,
        zones: zoneArray.map(zone => ({
          id: zone.id,
          level: zone.level,
          source: zone.source,
          description: zone.description,
          name: zone.name,
        })),
        coordinate: { latitude, longitude },
        checkedAt: new Date().toISOString(),
      });

    } catch (error) {
      logger.error('Safety check query failed:', error);
      throw app.httpErrors.internalServerError('Safety check failed');
    }
  });

  /**
   * Get zone statistics
   */
  app.get('/stats/summary', {
    schema: {
      tags: ['Zones'],
      summary: 'Get zone statistics',
      response: {
        200: {
          type: 'object',
          properties: {
            totalZones: { type: 'number' },
            byLevel: {
              type: 'object',
              properties: {
                GREEN: { type: 'number' },
                ORANGE: { type: 'number' },
                RED: { type: 'number' },
              },
            },
            bySource: {
              type: 'object',
              properties: {
                COMMUNITY: { type: 'number' },
                OFFICIAL: { type: 'number' },
                AI: { type: 'number' },
                WEATHER: { type: 'number' },
              },
            },
            totalArea: { type: 'number' },
            lastUpdated: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const stats = await prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_zones,
          SUM(CASE WHEN level = 'GREEN' THEN 1 ELSE 0 END) as green_zones,
          SUM(CASE WHEN level = 'ORANGE' THEN 1 ELSE 0 END) as orange_zones,
          SUM(CASE WHEN level = 'RED' THEN 1 ELSE 0 END) as red_zones,
          SUM(CASE WHEN source = 'COMMUNITY' THEN 1 ELSE 0 END) as community_zones,
          SUM(CASE WHEN source = 'OFFICIAL' THEN 1 ELSE 0 END) as official_zones,
          SUM(CASE WHEN source = 'AI' THEN 1 ELSE 0 END) as ai_zones,
          SUM(CASE WHEN source = 'WEATHER' THEN 1 ELSE 0 END) as weather_zones,
          SUM(COALESCE(area, 0)) as total_area,
          MAX(updated_at) as last_updated
        FROM zones 
        WHERE is_active = true
      `;

      const statsArray = stats as any[];
      const data = statsArray[0];

      reply.send({
        totalZones: parseInt(data.total_zones),
        byLevel: {
          GREEN: parseInt(data.green_zones),
          ORANGE: parseInt(data.orange_zones),
          RED: parseInt(data.red_zones),
        },
        bySource: {
          COMMUNITY: parseInt(data.community_zones),
          OFFICIAL: parseInt(data.official_zones),
          AI: parseInt(data.ai_zones),
          WEATHER: parseInt(data.weather_zones),
        },
        totalArea: parseFloat(data.total_area) || 0,
        lastUpdated: data.last_updated,
      });

    } catch (error) {
      logger.error('Zone statistics query failed:', error);
      throw app.httpErrors.internalServerError('Failed to fetch zone statistics');
    }
  });
}