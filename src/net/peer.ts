// WebRTC transport via PeerJS. The free public PeerJS broker is used only to introduce the two
// browsers to each other (signalling); game traffic then flows directly between them. No accounts,
// keys or paid servers are involved. PeerJS is loaded only when someone opens Multiplayer.
//
// Privacy: like any WebRTC game, connected players can see each other's network address, and the
// broker sees which room ids are online. This is documented in the README.

import type { Conn } from './room';

const PREFIX = 'chaos-theory-v1-';
export const peerIdFor = (code: string) => `${PREFIX}${code}`;

type PeerCtor = typeof import('peerjs').default;
let peerCtor: Promise<PeerCtor> | null = null;
const loadPeer = () => (peerCtor ??= import('peerjs').then((m) => m.default));

interface DataConnLike {
  open: boolean;
  send(d: unknown): void;
  close(): void;
  on(ev: 'open' | 'close' | 'error', cb: (e?: unknown) => void): void;
  on(ev: 'data', cb: (d: unknown) => void): void;
}

function wrap(dc: DataConnLike): Conn {
  const closers: (() => void)[] = [];
  let closed = false;
  const fire = () => {
    if (closed) return;
    closed = true;
    closers.forEach((f) => f());
  };
  dc.on('close', fire);
  dc.on('error', fire);
  return {
    send: (m) => {
      if (dc.open) dc.send(m);
    },
    close: () => {
      try {
        dc.close();
      } finally {
        fire();
      }
    },
    onData: (cb) => dc.on('data', cb),
    onClose: (cb) => closers.push(cb),
  };
}

export interface HostEndpoint {
  close(): void;
}

/**
 * Registers this browser as the host of room `code`. Resolves once the broker accepted the id.
 * Rejects with 'taken' if another room already uses the code (the caller picks a new one).
 */
export async function hostRoom(code: string, onConn: (c: Conn) => void, onBrokerLost: () => void): Promise<HostEndpoint> {
  const Peer = await loadPeer();
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerIdFor(code), { debug: 0 });
    let ready = false;
    peer.on('open', () => {
      ready = true;
      resolve({ close: () => peer.destroy() });
    });
    peer.on('connection', (dc) => {
      dc.on('open', () => onConn(wrap(dc as unknown as DataConnLike)));
    });
    peer.on('error', (err: { type?: string }) => {
      if (!ready) {
        peer.destroy();
        reject(new Error(err.type === 'unavailable-id' ? 'taken' : err.type ?? 'network'));
      }
    });
    peer.on('disconnected', () => {
      // Lost the broker: existing player connections keep working; try to stay reachable for rejoins.
      try {
        peer.reconnect();
      } catch {
        onBrokerLost();
      }
    });
  });
}

/** Opens a connection to the host of `code`. Rejects if the room cannot be found in time. */
export async function joinRoom(code: string): Promise<Conn> {
  const Peer = await loadPeer();
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    const fail = (why: string) => {
      clearTimeout(timer);
      peer.destroy();
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail('timeout'), 12000);
    peer.on('error', (err: { type?: string }) => fail(err.type ?? 'network'));
    peer.on('open', () => {
      const dc = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
      dc.on('open', () => {
        clearTimeout(timer);
        const conn = wrap(dc as unknown as DataConnLike);
        // When the game connection ends, release the broker connection too.
        conn.onClose(() => setTimeout(() => peer.destroy(), 0));
        resolve(conn);
      });
      dc.on('error', () => fail('connection'));
    });
  });
}
