import { useState, type FormEvent } from 'react';
import type { AccountService, AccountState } from '../cloud/account';

/** Shown when this build has no cloud configuration: honest, and no buttons that cannot work. */
export function GuestOnlyNotice() {
  return (
    <section className="account account-guest" aria-label="Account">
      <p className="account-title">Playing as a guest</p>
      <p className="account-text">
        Your progress is saved in this browser on this device. Accounts and cloud saves are not set up on this version of the game yet.
      </p>
    </section>
  );
}

type Mode = 'signin' | 'signup' | 'reset';

export function AccountPanel({ state, service }: { state: AccountState; service: AccountService }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'loading') {
    return (
      <section className="account" aria-label="Account" aria-busy="true">
        <p className="account-text">Checking your account…</p>
      </section>
    );
  }

  const message = state.message && (
    <p className="account-message" role="status">
      {state.message}
    </p>
  );

  if (state.status === 'recovery') {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      void run(() => service.setNewPassword(password));
    };
    return (
      <section className="account" aria-label="Account">
        <p className="account-title">Set a new password</p>
        <form className="account-form" onSubmit={submit}>
          <label>
            New password
            <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save password
          </button>
        </form>
        {message}
      </section>
    );
  }

  if (state.status === 'signed-in') {
    const syncText =
      state.sync === 'syncing'
        ? 'Syncing…'
        : state.sync === 'error'
          ? 'Not synced. Your progress is safe on this device; it will sync when the connection is back.'
          : state.lastSynced
            ? `Synced across your devices · ${new Date(state.lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Cloud save on';
    return (
      <section className="account account-on" aria-label="Account">
        <p className="account-title">
          Signed in<span className="dim"> · {state.email}</span>
        </p>
        <p className={`account-sync account-sync-${state.sync}`}>{syncText}</p>
        {!state.verified && state.email && (
          <p className="account-text">
            Email not verified yet.{' '}
            <button type="button" className="link-btn" disabled={busy} onClick={() => void run(() => service.resendVerification(state.email!))}>
              Resend the link
            </button>
          </p>
        )}
        <div className="account-actions">
          <button type="button" className="btn btn-small" disabled={busy || state.sync === 'syncing'} onClick={() => void run(() => service.syncNow())}>
            Sync now
          </button>
          <button type="button" className="btn btn-small" disabled={busy} onClick={() => void run(() => service.signOut())}>
            Sign out
          </button>
        </div>
        {message}
      </section>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'signin') void run(() => service.signIn(email.trim(), password));
    else if (mode === 'signup') void run(() => service.signUp(email.trim(), password));
    else void run(() => service.requestPasswordReset(email.trim()));
  };

  return (
    <section className="account" aria-label="Account">
      <p className="account-title">Playing as a guest</p>
      <p className="account-text">Progress is saved on this device. Sign in to keep it in the cloud and play on any device; what you have earned so far comes with you.</p>
      <div className="segmented account-tabs" role="tablist" aria-label="Account">
        {(
          [
            ['signin', 'Sign in'],
            ['signup', 'Create account'],
            ['reset', 'Forgot password'],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={`seg${mode === m ? ' seg-on' : ''}`} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      <form className="account-form" onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'reset' && (
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={mode === 'signup' ? 8 : undefined}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>
      {message}
    </section>
  );
}
