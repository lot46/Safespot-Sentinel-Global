// Mock Redis for testing
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
  pipeline: jest.fn().mockReturnValue({
    incr: jest.fn().mockReturnThis(),
    incrby: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]),
  }),
  info: jest.fn().mockResolvedValue('used_memory_human:1M\r\nconnected_clients:1\r\n'),
  quit: jest.fn().mockResolvedValue('OK'),
  connect: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  off: jest.fn(),
};

// Mock @fastify/redis plugin
jest.mock('@fastify/redis', () => {
  return {
    default: async function(fastify: any, options: any) {
      fastify.decorate('redis', mockRedis);
    }
  };
});

// Mock ioredis
jest.mock('ioredis', () => {
  return {
    default: jest.fn().mockImplementation(() => mockRedis)
  };
});

export { mockRedis };