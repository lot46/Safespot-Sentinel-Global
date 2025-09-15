/**
 * SafeSpot Sentinel Global V2 - WebSocket Real-Time System
 * Secure real-time communication for SOS, reports, and proximity alerts
 */

import { FastifyInstance } from 'fastify';
import { SocketStream } from '@fastify/websocket';
import { verifyAccessToken } from '../auth/jwt.js';
import { logger, logSecurityEvent } from '../utils/logger.js';
import { setWebSocketConnection, removeWebSocketConnection } from '../cache/redis.js';
import { getPrisma } from '../database/index.js';

const prisma = getPrisma();

interface WebSocketClient {
  id: string;
  userId?: string;
  channels: Set<string>;
  socket: SocketStream;
  authenticated: boolean;
  connectedAt: number;
  lastPing: number;
  ipAddress?: string;
}

class WebSocketManager {
  private clients = new Map<string, WebSocketClient>();
  private channels = new Map<string, Set<string>>(); // channel -> client IDs

  /**
   * Add new client connection
   */
  addClient(clientId: string, socket: SocketStream, ipAddress?: string): WebSocketClient {
    const client: WebSocketClient = {
      id: clientId,
      socket,
      channels: new Set(),
      authenticated: false,
      connectedAt: Date.now(),
      lastPing: Date.now(),
      ipAddress,
    };

    this.clients.set(clientId, client);
    logger.debug('WebSocket client connected', { clientId, ipAddress });

    return client;
  }

  /**
   * Remove client connection
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from all channels
    for (const channel of client.channels) {
      this.leaveChannel(clientId, channel);
    }

    // Remove from Redis
    removeWebSocketConnection(clientId).catch(error => {
      logger.warn('Failed to remove WebSocket connection from Redis:', error);
    });

    this.clients.delete(clientId);
    logger.debug('WebSocket client disconnected', { clientId, userId: client.userId });
  }

  /**
   * Authenticate client
   */
  async authenticateClient(clientId: string, token: string): Promise<boolean> {
    const client = this.clients.get(clientId);
    if (!client) return false;

    try {
      const payload = await verifyAccessToken(token);
      
      // Verify user exists and is active
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, isActive: true, isBanned: true, deletedAt: true },
      });

      if (!user || !user.isActive || user.isBanned || user.deletedAt) {
        throw new Error('User not found or inactive');
      }

      client.userId = payload.sub;
      client.authenticated = true;

      // Store connection metadata in Redis
      await setWebSocketConnection(clientId, {
        userId: payload.sub,
        channels: Array.from(client.channels),
        connectedAt: client.connectedAt,
        ipAddress: client.ipAddress,
      });

      logger.info('WebSocket client authenticated', { clientId, userId: payload.sub });
      return true;

    } catch (error) {
      logger.warn('WebSocket authentication failed', { clientId, error: error.message });
      
      logSecurityEvent({
        type: 'failed_login',
        severity: 'low',
        source: client.ipAddress || 'unknown',
        metadata: {
          reason: 'websocket_auth_failed',
          clientId,
          error: error.message,
        },
      });

      return false;
    }
  }

  /**
   * Join a channel
   */
  joinChannel(clientId: string, channel: string): boolean {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) return false;

    // Channel access control
    if (!this.canAccessChannel(client, channel)) {
      logger.warn('WebSocket channel access denied', { 
        clientId, 
        userId: client.userId, 
        channel 
      });
      return false;
    }

    client.channels.add(channel);

    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(clientId);

    logger.debug('WebSocket client joined channel', { clientId, userId: client.userId, channel });
    return true;
  }

  /**
   * Leave a channel
   */
  leaveChannel(clientId: string, channel: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.channels.delete(channel);
    }

    const channelClients = this.channels.get(channel);
    if (channelClients) {
      channelClients.delete(clientId);
      if (channelClients.size === 0) {
        this.channels.delete(channel);
      }
    }

    logger.debug('WebSocket client left channel', { clientId, channel });
  }

  /**
   * Broadcast message to channel
   */
  broadcastToChannel(channel: string, message: any, excludeClientId?: string): void {
    const channelClients = this.channels.get(channel);
    if (!channelClients) return;

    const messageStr = JSON.stringify(message);
    let sentCount = 0;

    for (const clientId of channelClients) {
      if (excludeClientId && clientId === excludeClientId) continue;

      const client = this.clients.get(clientId);
      if (client && client.socket.readyState === 1) { // WebSocket.OPEN
        try {
          client.socket.send(messageStr);
          sentCount++;
        } catch (error) {
          logger.warn('Failed to send WebSocket message', { clientId, error });
          this.removeClient(clientId);
        }
      }
    }

    logger.debug('Broadcast to channel completed', { 
      channel, 
      recipients: sentCount, 
      messageType: message.type 
    });
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: any): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== 1) return false;

    try {
      client.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      logger.warn('Failed to send WebSocket message to client', { clientId, error });
      this.removeClient(clientId);
      return false;
    }
  }

  /**
   * Send message to user (all their connections)
   */
  sendToUser(userId: string, message: any): number {
    let sentCount = 0;
    
    for (const [clientId, client] of this.clients) {
      if (client.userId === userId && client.authenticated) {
        if (this.sendToClient(clientId, message)) {
          sentCount++;
        }
      }
    }

    return sentCount;
  }

  /**
   * Check if client can access channel
   */
  private canAccessChannel(client: WebSocketClient, channel: string): boolean {
    if (!client.authenticated || !client.userId) return false;

    // Channel access rules
    if (channel === 'global') {
      return true; // Everyone can access global channel
    }

    if (channel.startsWith('user:')) {
      const userId = channel.replace('user:', '');
      return client.userId === userId; // Users can only access their own user channel
    }

    if (channel.startsWith('sos:')) {
      // SOS channels require special permission
      // TODO: Implement contact-based access control
      return true;
    }

    if (channel.startsWith('reports:')) {
      return true; // All authenticated users can access reports
    }

    if (channel.startsWith('admin:')) {
      // TODO: Check if user has admin role
      return false; // Temporarily disabled
    }

    return false;
  }

  /**
   * Get client statistics
   */
  getStats(): {
    totalClients: number;
    authenticatedClients: number;
    totalChannels: number;
    channelStats: Record<string, number>;
  } {
    const authenticatedClients = Array.from(this.clients.values())
      .filter(client => client.authenticated).length;

    const channelStats: Record<string, number> = {};
    for (const [channel, clients] of this.channels) {
      channelStats[channel] = clients.size;
    }

    return {
      totalClients: this.clients.size,
      authenticatedClients,
      totalChannels: this.channels.size,
      channelStats,
    };
  }

  /**
   * Cleanup inactive connections
   */
  cleanup(): void {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [clientId, client] of this.clients) {
      if (now - client.lastPing > timeout) {
        logger.info('Removing inactive WebSocket client', { clientId });
        this.removeClient(clientId);
      }
    }
  }
}

// Global WebSocket manager instance
const wsManager = new WebSocketManager();

/**
 * Initialize WebSocket server
 */
export async function initializeWebSocket(app: FastifyInstance): Promise<void> {
  // WebSocket route
  app.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (socket, request) => {
      const clientId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const ipAddress = request.ip;
      
      const client = wsManager.addClient(clientId, socket, ipAddress);

      // Connection timeout for unauthenticated clients
      const authTimeout = setTimeout(() => {
        if (!client.authenticated) {
          logger.warn('WebSocket client authentication timeout', { clientId });
          socket.close(4001, 'Authentication timeout');
        }
      }, 30000); // 30 seconds

      // Handle messages
      socket.on('message', async (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());
          await handleWebSocketMessage(clientId, data);
        } catch (error) {
          logger.warn('Invalid WebSocket message', { clientId, error });
          socket.send(JSON.stringify({
            type: 'error',
            message: 'Invalid message format',
          }));
        }
      });

      // Handle connection close
      socket.on('close', () => {
        clearTimeout(authTimeout);
        wsManager.removeClient(clientId);
      });

      // Send welcome message
      socket.send(JSON.stringify({
        type: 'connected',
        clientId,
        timestamp: Date.now(),
      }));
    });
  });

  // Cleanup interval
  setInterval(() => {
    wsManager.cleanup();
  }, 60000); // Every minute

  logger.info('✅ WebSocket server initialized');
}

/**
 * Handle incoming WebSocket messages
 */
async function handleWebSocketMessage(clientId: string, data: any): Promise<void> {
  const { type, payload } = data;

  switch (type) {
    case 'auth':
      await handleAuth(clientId, payload);
      break;

    case 'join_channel':
      handleJoinChannel(clientId, payload);
      break;

    case 'leave_channel':
      handleLeaveChannel(clientId, payload);
      break;

    case 'ping':
      handlePing(clientId);
      break;

    case 'sos_location_update':
      await handleSOSLocationUpdate(clientId, payload);
      break;

    default:
      logger.warn('Unknown WebSocket message type', { clientId, type });
      wsManager.sendToClient(clientId, {
        type: 'error',
        message: 'Unknown message type',
      });
  }
}

/**
 * Handle authentication
 */
async function handleAuth(clientId: string, payload: any): Promise<void> {
  const { token } = payload;

  if (!token) {
    wsManager.sendToClient(clientId, {
      type: 'auth_error',
      message: 'Token required',
    });
    return;
  }

  const success = await wsManager.authenticateClient(clientId, token);
  
  wsManager.sendToClient(clientId, {
    type: success ? 'auth_success' : 'auth_error',
    message: success ? 'Authenticated successfully' : 'Authentication failed',
  });
}

/**
 * Handle join channel
 */
function handleJoinChannel(clientId: string, payload: any): void {
  const { channel } = payload;

  if (!channel || typeof channel !== 'string') {
    wsManager.sendToClient(clientId, {
      type: 'error',
      message: 'Channel name required',
    });
    return;
  }

  const success = wsManager.joinChannel(clientId, channel);
  
  wsManager.sendToClient(clientId, {
    type: success ? 'channel_joined' : 'channel_error',
    channel,
    message: success ? 'Joined channel successfully' : 'Failed to join channel',
  });
}

/**
 * Handle leave channel
 */
function handleLeaveChannel(clientId: string, payload: any): void {
  const { channel } = payload;

  wsManager.leaveChannel(clientId, channel);
  
  wsManager.sendToClient(clientId, {
    type: 'channel_left',
    channel,
  });
}

/**
 * Handle ping
 */
function handlePing(clientId: string): void {
  const client = wsManager['clients'].get(clientId);
  if (client) {
    client.lastPing = Date.now();
  }

  wsManager.sendToClient(clientId, {
    type: 'pong',
    timestamp: Date.now(),
  });
}

/**
 * Handle SOS location update
 */
async function handleSOSLocationUpdate(clientId: string, payload: any): Promise<void> {
  const client = wsManager['clients'].get(clientId);
  if (!client?.authenticated || !client.userId) return;

  const { sessionId, latitude, longitude } = payload;

  // Verify SOS session belongs to user
  const session = await prisma.sOSSession.findFirst({
    where: {
      id: sessionId,
      userId: client.userId,
      state: 'ACTIVE',
    },
  });

  if (!session) {
    wsManager.sendToClient(clientId, {
      type: 'error',
      message: 'Invalid SOS session',
    });
    return;
  }

  // Broadcast location update to SOS channel
  wsManager.broadcastToChannel(`sos:${sessionId}`, {
    type: 'sos_location_update',
    sessionId,
    location: { latitude, longitude },
    timestamp: Date.now(),
  }, clientId);
}

/**
 * Broadcast new report to all clients in reports channel
 */
export function broadcastNewReport(report: any): void {
  wsManager.broadcastToChannel('reports:global', {
    type: 'new_report',
    report: {
      id: report.id,
      type: report.type,
      title: report.title,
      latitude: report.latitude,
      longitude: report.longitude,
      trustScore: report.trustScore,
      createdAt: report.createdAt,
    },
    timestamp: Date.now(),
  });
}

/**
 * Send SOS alert to specific user
 */
export function sendSOSAlert(userId: string, alert: any): number {
  return wsManager.sendToUser(userId, {
    type: 'sos_alert',
    alert,
    timestamp: Date.now(),
  });
}

/**
 * Get WebSocket statistics
 */
export function getWebSocketStats() {
  return wsManager.getStats();
}