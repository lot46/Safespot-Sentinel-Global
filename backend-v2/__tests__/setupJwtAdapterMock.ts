const tokenStore = new Map<string, any>();

function makeToken(type: 'access' | 'refresh'): string {
  const rand = Math.random().toString(36).slice(2);
  return `mock.${type}.${rand}`;
}

jest.mock('../src/auth/jwtAdapter.js', () => {
  return {
    signJWT: jest.fn(async (payload: any, secret: string, expSeconds: number, subject: string) => {
      const type = payload.type || 'access';
      const token = makeToken(type);
      tokenStore.set(token, {
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + expSeconds,
      });
      return token;
    }),
    verifyJWT: jest.fn(async (token: string, secret: string) => {
      if (token.includes('expired')) {
        throw new Error('Token expired');
      }
      const payload = tokenStore.get(token);
      if (!payload) {
        // default payload for safety
        return {
          sub: 'mock-user-id',
          email: 'mock@example.com',
          role: 'USER',
          sessionId: 'mock-session',
          type: token.includes('refresh') ? 'refresh' : 'access',
          jti: 'mock-jti',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        };
      }
      return payload;
    }),
  };
});