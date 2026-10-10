import { Client, type Room } from '@colyseus/sdk';
import { useEffect, useState } from 'react';

import type { ServerEndpoint } from '../config/server';
import { track } from '../services/analytics';

export type EchoStatus =
  | { kind: 'connecting' }
  | { kind: 'connected'; rttMs: number | null; samples: number }
  | { kind: 'error'; message: string };

/**
 * Stage 0: joins the server's `echo` room and measures the ping → pong round trip once a second.
 * (Clock sync and the latency metrics of spec §18 come in stage 7.)
 */
export function useEchoRtt(endpoint: ServerEndpoint, intervalMs = 1000): EchoStatus {
  const [status, setStatus] = useState<EchoStatus>({ kind: 'connecting' });

  useEffect(() => {
    let room: Room | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let samples = 0;
    let cancelled = false;

    new Client(endpoint)
      .joinOrCreate('echo')
      .then((joined) => {
        if (cancelled) {
          void joined.leave();
          return;
        }
        room = joined;
        setStatus({ kind: 'connected', rttMs: null, samples: 0 });
        joined.onMessage('pong', (m: { t: number }) => {
          const rttMs = Date.now() - m.t;
          samples++;
          setStatus({ kind: 'connected', rttMs, samples });
          if (samples === 1) track('latency_sample', { rttMs });
        });
        const ping = () => joined.send('ping', { t: Date.now() });
        ping();
        timer = setInterval(ping, intervalMs);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      void room?.leave();
    };
  }, [endpoint, intervalMs]);

  return status;
}
