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

describe('RBAC, CSRF & SOS', () => {
  test('CSRF double-submit cookie required on unsafe methods', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect([401,403]).toContain(res.statusCode);
    await app.close();
  });

  test('Admin-only route should be forbidden for USER', async () => {
    const app = await build();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user@safespot.local', password: 'User123!@#' },
    });
    const token = login.json()?.tokens?.accessToken;
    const res = await app.inject({ method: 'GET', url: '/api/admin/stats', headers: { Authorization: `Bearer ${token}` } });
    expect([401,403]).toContain(res.statusCode);
    await app.close();
  });
});
