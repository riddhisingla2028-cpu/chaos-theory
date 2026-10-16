import { describe, expect, it } from 'vitest';
import { applyRun, defaultProgress, type Progress } from '../progress';
import { AccountService, cloudConfigFrom, type CloudClient, type AuthSession } from './account';
import { mergeProgress } from './merge';

const run = (p: Progress, over: Partial<Parameters<typeof applyRun>[1]> = {}) =>
  applyRun(p, { mode: 'stage', stage: 0, won: true, score: 300, time: 15, nearMisses: 3, peakMultiplier: 1.5, chaosSurvived: [], ...over }, new Date(2026, 9, 16)).progress;

describe('merging this device with the cloud', () => {
  it('keeps the best of both and loses nothing', () => {
    let a = defaultProgress();
    a = run(a, { stage: 0, score: 500 });
    let b = defaultProgress();
    b = run(b, { stage: 0, score: 200 });
    b = { ...b, stages: { ...b.stages, 1: { stars: 3, best: 900 } }, achievements: ['x'] };
    const m = mergeProgress(a, b);
    expect(m.stages[0].best).toBe(500);
    expect(m.stages[1]).toEqual({ stars: 3, best: 900 });
    expect(m.achievements).toContain('x');
    expect(m.xp).toBe(Math.max(a.xp, b.xp));
  });

  it('is safe to repeat: merging again changes nothing', () => {
    const a = run(defaultProgress());
    const b = run(run(defaultProgress(), { stage: 1, score: 50, won: false }));
    const once = mergeProgress(a, b);
    expect(mergeProgress(once, b)).toEqual(once);
    expect(mergeProgress(once, once)).toEqual(once);
  });

  it('never takes settings or the cosmetics preview flag from the cloud', () => {
    const local = { ...defaultProgress(), premiumDemo: false };
    local.settings = { ...local.settings, sfxVolume: 0.3 };
    const cloud = { ...defaultProgress(), premiumDemo: true };
    cloud.settings = { ...cloud.settings, sfxVolume: 1 };
    const m = mergeProgress(local, cloud);
    expect(m.settings.sfxVolume).toBe(0.3);
    expect(m.premiumDemo).toBe(false);
  });

  it('an older device cannot lower newer records', () => {
    const newer = { ...defaultProgress(), xp: 5000, runs: 80, stageStats: { 2: { attempts: 9, deaths: 7, fastest: 31 } } };
    const older = { ...defaultProgress(), xp: 200, runs: 4, stageStats: { 2: { attempts: 2, deaths: 2, fastest: null } } };
    const m = mergeProgress(older, newer);
    expect(m.xp).toBe(5000);
    expect(m.runs).toBe(80);
    expect(m.stageStats[2]).toEqual({ attempts: 9, deaths: 7, fastest: 31 });
  });
});

describe('cloud configuration', () => {
  it('needs both a https URL and an anon key, otherwise guest mode', () => {
    expect(cloudConfigFrom({})).toBeNull();
    expect(cloudConfigFrom({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
    expect(cloudConfigFrom({ VITE_SUPABASE_URL: 'http://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k'.repeat(40) })).toBeNull();
    expect(cloudConfigFrom({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k'.repeat(40) })).not.toBeNull();
  });
});

/** An in-memory stand-in for Supabase auth and the saves table (a simulation, for unit tests only). */
function fakeCloud() {
  const users = new Map<string, { id: string; password: string; confirmed: boolean }>();
  const saves = new Map<string, unknown>();
  let session: AuthSession | null = null;
  const listeners: ((e: string, s: AuthSession | null) => void)[] = [];
  const emit = (e: string) => listeners.forEach((l) => l(e, session));
  const ok = <T>(data: T) => Promise.resolve({ data, error: null });
  const err = (message: string) => Promise.resolve({ data: { user: null, session: null }, error: { message } });
  const client: CloudClient = {
    auth: {
      getSession: () => ok({ session }),
      signUp: ({ email, password }) => {
        if (users.has(email)) return err('User already registered');
        users.set(email, { id: `u-${users.size + 1}`, password, confirmed: false });
        return ok({ user: { id: users.get(email)!.id, email }, session: null });
      },
      signInWithPassword: ({ email, password }) => {
        const u = users.get(email);
        if (!u || u.password !== password) return err('Invalid login credentials');
        if (!u.confirmed) return err('Email not confirmed');
        session = { user: { id: u.id, email, email_confirmed_at: '2026-10-16' } };
        emit('SIGNED_IN');
        return ok({ user: session.user, session });
      },
      signOut: () => {
        session = null;
        emit('SIGNED_OUT');
        return Promise.resolve({ error: null });
      },
      resetPasswordForEmail: () => ok({}),
      updateUser: ({ password }) => {
        for (const u of users.values()) if (session && u.id === session.user.id) u.password = password;
        return ok({ user: session?.user ?? null });
      },
      resend: () => ok({}),
      onAuthStateChange: (cb) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
    from: () => ({
      select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: () => ok(saves.has(id) ? { data: saves.get(id), updated_at: 'now' } : null) }) }),
      upsert: (row) => {
        if (!session || row.user_id !== session.user.id) return Promise.resolve({ data: null, error: { message: 'row-level security' } });
        saves.set(row.user_id as string, JSON.parse(JSON.stringify(row.data)));
        return ok(null);
      },
    }),
  };
  return { client, users, saves };
}

function device(start: Progress) {
  let p = start;
  return { get: () => p, set: (n: Progress) => (p = n) };
}

describe('accounts (against a simulated Supabase)', () => {
  it('guest progress moves into a new account on first sign-in, and another device gets it', async () => {
    const cloud = fakeCloud();
    const phone = device(run(defaultProgress(), { stage: 0, score: 777 }));
    const svc = new AccountService(cloud.client, phone, 'https://game.example/');
    await svc.start();
    expect(svc.snapshot.status).toBe('guest');
    expect(await svc.signUp('a@example.com', 'short')).toBe(false); // too short
    expect(await svc.signUp('a@example.com', 'long-enough-pw')).toBe(true);
    expect(svc.snapshot.message).toMatch(/verify/i);
    expect(await svc.signIn('a@example.com', 'long-enough-pw')).toBe(false); // not verified yet
    cloud.users.get('a@example.com')!.confirmed = true;
    expect(await svc.signIn('a@example.com', 'long-enough-pw')).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.snapshot.status).toBe('signed-in');
    expect(svc.snapshot.sync).toBe('synced');
    const stored = cloud.saves.get('u-1') as Progress;
    expect(stored.stages[0].best).toBe(777);
    expect('settings' in stored).toBe(false);

    // A second device with its own progress signs in: it receives the phone's records and keeps its own.
    await svc.signOut();
    const laptop = device(run(defaultProgress(), { stage: 1, score: 444 }));
    const svc2 = new AccountService(cloud.client, laptop, 'https://game.example/');
    await svc2.start();
    await svc2.signIn('a@example.com', 'long-enough-pw');
    await new Promise((r) => setTimeout(r, 0));
    expect(laptop.get().stages[0].best).toBe(777);
    expect(laptop.get().stages[1].best).toBe(444);
    expect((cloud.saves.get('u-1') as Progress).stages[1].best).toBe(444);
  });

  it('wrong password gives a friendly message and changes nothing', async () => {
    const cloud = fakeCloud();
    const d = device(defaultProgress());
    const svc = new AccountService(cloud.client, d, '/');
    await svc.start();
    expect(await svc.signIn('nobody@example.com', 'x')).toBe(false);
    expect(svc.snapshot.message).toBe('Email or password is not right.');
    expect(svc.snapshot.status).toBe('guest');
  });

  it('password reset does not reveal whether an email has an account', async () => {
    const cloud = fakeCloud();
    const svc = new AccountService(cloud.client, device(defaultProgress()), '/');
    await svc.start();
    await svc.requestPasswordReset('unknown@example.com');
    expect(svc.snapshot.message).toMatch(/If unknown@example.com has an account/);
  });

  it('a failed sync keeps local progress and reports the problem', async () => {
    const cloud = fakeCloud();
    const d = device(run(defaultProgress()));
    const svc = new AccountService(cloud.client, d, '/');
    cloud.users.set('b@example.com', { id: 'u-9', password: 'password123', confirmed: true });
    await svc.start();
    await svc.signIn('b@example.com', 'password123');
    await new Promise((r) => setTimeout(r, 0));
    const before = d.get();
    cloud.client.from = () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }) }) }),
      upsert: () => Promise.resolve({ data: null, error: null }),
    });
    await svc.syncNow();
    expect(svc.snapshot.sync).toBe('error');
    expect(svc.snapshot.message).toMatch(/still saved on this device/);
    expect(d.get()).toBe(before);
  });
});
