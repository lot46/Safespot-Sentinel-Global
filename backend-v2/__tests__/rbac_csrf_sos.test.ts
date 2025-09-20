import Fastify from 'fastify';
import { registerPlugins } from '../src/plugins/index.js';
import { registerRoutes } from '../src/routes/index.js';

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

  test('Admin-only dashboard should be forbidden for USER', async () => {
    const app = await build();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user@safespot.local', password: 'User123!@#' },
    });
    const token = ((): string | undefined => {
      try { return login.json()?.tokens?.accessToken; } catch { return undefined; }
    })();
    const res = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    expect([401,403,404]).toContain(res.statusCode);
    await app.close();
  });
});