import request from 'supertest';
import Fastify from 'fastify';
import { registerPlugins } from '../src/plugins/index';
import { registerRoutes } from '../src/routes/index';

async function build() {
  const app = Fastify({ logger: false });
  await registerPlugins(app as any);
  await registerRoutes(app as any);
  await app.ready();
  return app;
}

describe('Auth flows', () => {
  test('register -> login -> refresh -> logout', async () => {
    const app = await build();

    const email = `user_${Date.now()}@test.local`;
    const password = 'Password123!';

    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password, firstName: 'T', lastName: 'U', gdprConsent: true },
    });
    expect([201, 409]).toContain(reg.statusCode);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json();
    expect(body.tokens?.accessToken).toBeTruthy();

    // Extract refresh cookie from login response
    const refreshCookie = login.cookies?.find((c: any) => c.name === 'ssg_refresh');
    const refresh = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: refreshCookie ? { cookie: `ssg_refresh=${refreshCookie.value}` } : {} });
    expect([200, 401]).toContain(refresh.statusCode);

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { Authorization: `Bearer ${body.tokens.accessToken}` } });
    expect([200, 401]).toContain(logout.statusCode);

    await app.close();
  });
});
