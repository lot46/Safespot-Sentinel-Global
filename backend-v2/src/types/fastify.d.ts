import type { Config } from '../config/index';
import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}