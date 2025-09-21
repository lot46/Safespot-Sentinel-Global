/**
 * SafeSpot Sentinel Global V2 - Admin Routes (RBAC)
 */
import { FastifyInstance } from 'fastify';

export default async function adminRoutes(app: FastifyInstance) {
  // Simple admin-only dashboard
  app.get('/dashboard', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!;
    if (user.role !== 'ADMIN') {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }
    reply.send({ ok: true, dashboard: { users: 0, reports: 0, sosActive: 0 } });
  });

  // Admin test notifier (stub)
  app.post('/notify/test', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = request.user!; if (user.role !== 'ADMIN') return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    // TODO: broadcast via WS manager
    reply.send({ ok: true, delivered: true });
  });
}