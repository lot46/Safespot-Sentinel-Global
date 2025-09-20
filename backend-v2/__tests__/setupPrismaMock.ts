import bcrypt from 'bcrypt';

type User = any;
type UserPreferences = any;
type UserContact = any;
type Report = any;
type Payment = any;

type WhereUnique = { id?: string; email?: string; phoneSearchHash?: string };

type Store = {
  users: User[];
  prefs: UserPreferences[];
  contacts: UserContact[];
  reports: Report[];
  payments: Payment[];
};

const store: Store = {
  users: [],
  prefs: [],
  contacts: [],
  reports: [],
  payments: [],
};

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function now() { return new Date(); }

function clone<T>(obj: T): T { return JSON.parse(JSON.stringify(obj)); }

// Seed admin and user
async function seed() {
  if (store.users.length > 0) return;
  const adminHash = await bcrypt.hash('Admin123!@#', 10);
  const userHash = await bcrypt.hash('User123!@#', 10);

  const adminId = uuid();
  const userId = uuid();

  const admin: any = {
    id: adminId,
    email: 'admin@safespot.local',
    passwordHash: adminHash,
    firstName: 'SafeSpot',
    lastName: 'Admin',
    role: 'ADMIN',
    isActive: true,
    isBanned: false,
    isPremium: false,
    emailVerified: true,
    phoneVerified: false,
    createdAt: now(),
    updatedAt: now(),
  };

  const user: any = {
    id: userId,
    email: 'user@safespot.local',
    passwordHash: userHash,
    firstName: 'Ava',
    lastName: 'Martin',
    role: 'USER',
    isActive: true,
    isBanned: false,
    isPremium: false,
    emailVerified: true,
    phoneVerified: false,
    createdAt: now(),
    updatedAt: now(),
  };

  store.users.push(admin, user);

  store.prefs.push(
    { id: uuid(), userId: adminId, alertRadiusM: 2000, categories: { crime: true }, theme: 'DARK', pushEnabled: true, emailEnabled: true, createdAt: now(), updatedAt: now() },
    { id: uuid(), userId: userId, alertRadiusM: 2000, categories: { crime: true }, theme: 'LIGHT', pushEnabled: true, emailEnabled: true, createdAt: now(), updatedAt: now() },
  );
}

// Minimal Prisma-like client
const mockPrisma: any = {
  user: {
    findUnique: async ({ where, select, include }: { where: WhereUnique; select?: any; include?: any }) => {
      const u = store.users.find((x) => (where.id && x.id === where.id) || (where.email && x.email === where.email) || (where.phoneSearchHash && x.phoneSearchHash === where.phoneSearchHash));
      if (!u) return null;
      if (include?.preferences) {
        const pref = store.prefs.find((p) => p.userId === u.id) || null;
        return { ...clone(u), preferences: pref };
      }
      return clone(u);
    },
    findFirst: async ({ where }: { where: any }) => {
      return clone(store.users.find((x) => {
        let ok = true;
        if (where.id) ok = ok && x.id === where.id;
        if (where.email) ok = ok && x.email === where.email;
        if (where.phoneSearchHash) ok = ok && x.phoneSearchHash === where.phoneSearchHash;
        if (where.id?.not) ok = ok && x.id !== where.id.not;
        return ok;
      }) || null);
    },
    upsert: async ({ where, create, update }: { where: WhereUnique; create: any; update: any }) => {
      let u = store.users.find((x) => (where.id && x.id === where.id) || (where.email && x.email === where.email));
      if (u) {
        Object.assign(u, update);
        return clone(u);
      }
      u = { id: uuid(), ...create, createdAt: now(), updatedAt: now() };
      store.users.push(u);
      return clone(u);
    },
    create: async ({ data }: { data: any }) => {
      const u = { id: uuid(), ...data, createdAt: now(), updatedAt: now() };
      store.users.push(u);
      return clone(u);
    },
    update: async ({ where, data, select }: { where: WhereUnique; data: any; select?: any }) => {
      const idx = store.users.findIndex((x) => (where.id && x.id === where.id) || (where.email && x.email === where.email));
      if (idx === -1) throw new Error('User not found');
      store.users[idx] = { ...store.users[idx], ...data, updatedAt: now() };
      const updated = store.users[idx];
      if (select) {
        const selObj: any = {};
        for (const k of Object.keys(select)) {
          selObj[k] = updated[k];
        }
        return clone(selObj);
      }
      return clone(updated);
    },
    count: async ({ where }: { where?: any }) => {
      return store.users.filter((x) => !where || Object.keys(where).every((k) => x[k] === where[k])).length;
    },
  },
  userPreferences: {
    findUnique: async ({ where }: { where: any }) => {
      const pref = store.prefs.find((p) => p.userId === where.userId);
      return clone(pref || null);
    },
  },
  userContact: {
    count: async ({ where }: { where: any }) => {
      return store.contacts.filter((c) => c.userId === where.userId && (where.isActive === undefined || c.isActive === where.isActive)).length;
    },
    findFirst: async ({ where }: { where: any }) => {
      return clone(store.contacts.find((c) => c.userId === where.userId && c.type === where.type && c.valueHash === where.valueHash && (where.isActive === undefined || c.isActive === where.isActive)) || null);
    },
    create: async ({ data }: { data: any }) => {
      const c = { id: uuid(), ...data, createdAt: now(), updatedAt: now(), isActive: data.isActive ?? true };
      store.contacts.push(c);
      return clone(c);
    },
    findMany: async ({ where, orderBy }: { where: any; orderBy?: any[] }) => {
      const list = store.contacts.filter((c) => c.userId === where.userId && (where.isActive === undefined || c.isActive === where.isActive));
      return clone(list);
    },
  },
  report: {
    create: async ({ data }: { data: any }) => {
      const r = { id: uuid(), ...data, createdAt: now(), updatedAt: now() };
      store.reports.push(r);
      return clone(r);
    },
    findMany: async ({ orderBy, skip, take }: { orderBy?: any; skip?: number; take?: number }) => {
      const sorted = [...store.reports].sort((a, b) => (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      const page = sorted.slice(skip || 0, (skip || 0) + (take || sorted.length));
      return clone(page);
    },
    count: async ({ where }: { where?: any }) => {
      return store.reports.length;
    },
  },
  payment: {
    create: async ({ data }: { data: any }) => {
      const p = { id: uuid(), ...data, createdAt: now() };
      store.payments.push(p);
      return clone(p);
    },
  },
  sOSSession: {
    count: async ({ where }: { where: any }) => {
      return 0;
    },
  },
  $connect: async () => {},
  $disconnect: async () => {},
  $queryRaw: async (...args: any[]) => [{ health: 1 }],
  $use: (...args: any[]) => {},
};

// Apply seed before tests
beforeAll(async () => {
  await seed();
});

// Jest module mock for getPrisma
jest.mock('../src/database/index.js', () => {
  return {
    getPrisma: () => mockPrisma,
  };
});

export { mockPrisma, store };