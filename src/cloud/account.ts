// Player accounts and cloud saves, backed by Supabase when (and only when) it is configured.
//
// Configuration is public and comes from the build environment:
//   VITE_SUPABASE_URL       e.g. https://abcd.supabase.co
//   VITE_SUPABASE_ANON_KEY  the project's public "anon" key (safe in a browser; access is limited by RLS)
// The service-role key must NEVER be used here or anywhere in the frontend.
// Without both values the game runs in guest mode only, and no account UI pretends otherwise.
// Database setup (tables, row-level security, validation) is in supabase/schema.sql.

import { defaultProgress, type Progress } from '../progress';
import { mergeProgress } from './merge';

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export function cloudConfigFrom(env: Record<string, unknown>): CloudConfig | null {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : '';
  const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : '';
  if (!/^https:\/\/[^\s/]+/.test(url) || anonKey.length < 20) return null;
  return { url, anonKey };
}

export const CLOUD_CONFIG = cloudConfigFrom(import.meta.env as unknown as Record<string, unknown>);

// ---------- The small part of the Supabase client this game uses ----------

export interface AuthUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
}
export interface AuthSession {
  user: AuthUser;
}
type Res<T> = Promise<{ data: T; error: { message: string } | null }>;

export interface CloudClient {
  auth: {
    getSession(): Res<{ session: AuthSession | null }>;
    signUp(a: { email: string; password: string; options?: { emailRedirectTo?: string } }): Res<{ user: AuthUser | null; session: AuthSession | null }>;
    signInWithPassword(a: { email: string; password: string }): Res<{ user: AuthUser | null; session: AuthSession | null }>;
    signOut(): Promise<{ error: { message: string } | null }>;
    resetPasswordForEmail(email: string, o?: { redirectTo?: string }): Res<unknown>;
    updateUser(a: { password: string }): Res<{ user: AuthUser | null }>;
    resend(a: { type: 'signup'; email: string; options?: { emailRedirectTo?: string } }): Res<unknown>;
    onAuthStateChange(cb: (event: string, session: AuthSession | null) => void): { data: { subscription: { unsubscribe(): void } } };
  };
  from(table: string): {
    select(cols: string): { eq(col: string, v: string): { maybeSingle(): Res<{ data: unknown; updated_at: string } | null> } };
    upsert(row: Record<string, unknown>): Res<unknown>;
  };
}

/** Loads the Supabase SDK only when cloud saves are configured, so guests download nothing extra. */
export async function createSupabaseClient(cfg: CloudConfig): Promise<CloudClient> {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) as unknown as CloudClient;
}

// ---------- Account service ----------

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error';

export interface AccountState {
  status: 'loading' | 'guest' | 'signed-in' | 'recovery';
  email: string | null;
  verified: boolean;
  sync: SyncState;
  lastSynced: string | null;
  message: string | null; // the latest friendly error or notice
}

const SAVES = 'saves';
const friendly = (msg: string) =>
  /invalid login/i.test(msg)
    ? 'Email or password is not right.'
    : /not confirmed/i.test(msg)
      ? 'Please verify your email first. Check your inbox for the link.'
      : /rate|too many/i.test(msg)
        ? 'Too many attempts. Please wait a minute and try again.'
        : /network|fetch/i.test(msg)
          ? 'Could not reach the server. Your progress is still saved on this device.'
          : msg;

export class AccountService {
  private state: AccountState = { status: 'loading', email: null, verified: false, sync: 'idle', lastSynced: null, message: null };
  private listeners = new Set<(s: AccountState) => void>();
  private userId: string | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void) | null = null;

  constructor(
    private readonly client: CloudClient,
    /** Reads and writes this device's save; the cloud never replaces it, only merges into it. */
    private readonly local: { get(): Progress; set(p: Progress): void },
    private readonly redirectTo: string,
  ) {}

  get snapshot(): AccountState {
    return this.state;
  }

  subscribe(fn: (s: AccountState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<AccountState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  async start(): Promise<void> {
    const sub = this.client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') this.set({ status: 'recovery', message: 'Choose a new password.' });
      else if (session) void this.onSignedIn(session);
      else if (event === 'SIGNED_OUT') this.onSignedOut();
    });
    this.unsub = () => sub.data.subscription.unsubscribe();
    try {
      const { data } = await this.client.auth.getSession();
      if (data.session) await this.onSignedIn(data.session);
      else if (this.state.status === 'loading') this.set({ status: 'guest' });
    } catch {
      this.set({ status: 'guest', message: 'Could not reach the account server. Playing as a guest for now.' });
    }
  }

  stop(): void {
    this.unsub?.();
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }

  private async onSignedIn(session: AuthSession): Promise<void> {
    const first = this.userId !== session.user.id;
    this.userId = session.user.id;
    if (this.state.status !== 'recovery') this.set({ status: 'signed-in' });
    this.set({ email: session.user.email ?? null, verified: !!session.user.email_confirmed_at });
    // On signing in, this device's (guest) progress is merged into the account, never discarded.
    if (first) await this.syncNow();
  }

  private onSignedOut(): void {
    this.userId = null;
    this.set({ status: 'guest', email: null, verified: false, sync: 'idle', lastSynced: null });
  }

  async signUp(email: string, password: string): Promise<boolean> {
    if (password.length < 8) {
      this.set({ message: 'Use at least 8 characters for your password.' });
      return false;
    }
    const { data, error } = await this.client.auth.signUp({ email, password, options: { emailRedirectTo: this.redirectTo } });
    if (error) {
      this.set({ message: friendly(error.message) });
      return false;
    }
    this.set({ message: data.session ? 'Account created.' : `Check ${email} for a link to verify your account, then sign in.` });
    return true;
  }

  async signIn(email: string, password: string): Promise<boolean> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) {
      this.set({ message: friendly(error.message) });
      return false;
    }
    this.set({ message: null });
    return true;
  }

  async resendVerification(email: string): Promise<void> {
    const { error } = await this.client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: this.redirectTo } });
    this.set({ message: error ? friendly(error.message) : `Verification email sent to ${email}.` });
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: this.redirectTo });
    // Same message either way, so the form does not reveal which emails have accounts.
    this.set({ message: error && /rate|network|fetch/i.test(error.message) ? friendly(error.message) : `If ${email} has an account, a reset link is on its way.` });
  }

  async setNewPassword(password: string): Promise<boolean> {
    if (password.length < 8) {
      this.set({ message: 'Use at least 8 characters for your password.' });
      return false;
    }
    const { error } = await this.client.auth.updateUser({ password });
    if (error) {
      this.set({ message: friendly(error.message) });
      return false;
    }
    this.set({ status: this.userId ? 'signed-in' : 'guest', message: 'Password updated.' });
    return true;
  }

  async signOut(): Promise<void> {
    // Sync first so nothing earned on this device is left behind.
    if (this.userId) await this.syncNow();
    await this.client.auth.signOut();
    this.onSignedOut();
    this.set({ message: 'Signed out. Your progress stays on this device too.' });
  }

  /** Call after any local progress change; syncs shortly after, batching quick changes. */
  scheduleSync(delayMs = 1500): void {
    if (!this.userId) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.syncNow(), delayMs);
  }

  /**
   * Fetch the cloud save, merge it with this device's save (keeping the best of both), store the
   * result locally and upload it. Merging (not overwriting) means a stale device can never erase
   * newer progress made elsewhere.
   */
  async syncNow(): Promise<void> {
    const uid = this.userId;
    if (!uid) return;
    this.set({ sync: 'syncing' });
    try {
      const { data, error } = await this.client.from(SAVES).select('data, updated_at').eq('user_id', uid).maybeSingle();
      if (error) throw new Error(error.message);
      const local = this.local.get();
      const cloud = data?.data && typeof data.data === 'object' ? ({ ...defaultProgress(), ...(data.data as Partial<Progress>) } as Progress) : null;
      const merged = cloud ? mergeProgress(local, cloud) : local;
      if (merged !== local) this.local.set(merged);
      const { settings: _settings, premiumDemo: _demo, ...synced } = merged;
      const up = await this.client.from(SAVES).upsert({ user_id: uid, data: synced, save_version: merged.saveVersion });
      if (up.error) throw new Error(up.error.message);
      this.set({ sync: 'synced', lastSynced: new Date().toISOString() });
    } catch (e) {
      this.set({ sync: 'error', message: friendly(e instanceof Error ? e.message : 'Sync failed') });
    }
  }
}
