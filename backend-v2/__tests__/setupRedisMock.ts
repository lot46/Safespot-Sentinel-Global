// Mock Redis and plugin
const mockRedis = {
  ping: jest.fn().mockResolvedValue('PONG'),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  exists: jest.fn().mockResolvedValue(0),
  incr: jest.fn().mockResolvedValue(1),
  incrby: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  pipeline: jest.fn().mockReturnValue({ incr: jest.fn().mockReturnThis(), incrby: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]) }),
  info: jest.fn().mockResolvedValue('used_memory_human:1M\r\nconnected_clients:1\r\n'),
  quit: jest.fn().mockResolvedValue('OK'),
  connect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  off: jest.fn(),
};

jest.mock('@fastify/redis', () => ({
  default: async function (fastify: any, _options: any) {
    fastify.decorate('redis', mockRedis);
  }
}));

jest.mock('ioredis', () => ({ default: jest.fn().mockImplementation(() => mockRedis) }));

export { mockRedis };