/**
 * SafeSpot Sentinel Global V2 - WebSocket Notifications (Phase 4 scaffolds)
 */
import { FastifyInstance } from 'fastify';

const subscribers = new Set<any>();

export async function initializeWebSocket(app: FastifyInstance) {
  app.get('/ws/alerts', { websocket: true }, (connection, req) => {
    subscribers.add(connection);
    connection.socket.on('close', () => subscribers.delete(connection));
  });
}

export function broadcast(message: any) {
  for (const client of subscribers) {
    try { client.socket.send(JSON.stringify(message)); } catch {}
  }
}