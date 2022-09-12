import pest, { PeerError } from '@savid/libp2p-pest';
import logger from '@savid/logger';
import { each } from 'async';

import {
  REMOTE_SEND_ENDPOINT,
  REMOTE_GET_ENDPOINT,
  SHARED_SECRET,
  REMOTE_SEND_INTERVAL,
  REMOTE_GET_INTERVAL,
  REMOTE_GET_COUNT,
  QUEUE_MAX_LIMIT,
  PARALLEL_GREETS,
} from '#app/constants';
import Metrics from '#app/metrics';

interface Status {
  enr: string;
  error?: {
    message: string;
    code?: PeerError['code'];
  };
  data?: Awaited<ReturnType<typeof pest>>;
  date: string;
}

export default class Greeter {
  static hydrateInterval: NodeJS.Timeout | undefined;

  static hydrateAbortController: AbortController | undefined;

  static sendInterval: NodeJS.Timeout | undefined;

  static sendAbortController: AbortController | undefined;

  static enrs: string[] = [];

  static statuses: Status[] = [];

  static started = true;

  static init() {
    this.hydrater();
    this.sender();
    this.greeter();
  }

  static async greeter() {
    while (this.started) {
      if (this.enrs.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await each(this.enrs.splice(0, PARALLEL_GREETS), async (enr) => {
          try {
            const data = await pest({
              enr,
            });
            this.statuses.push({
              enr,
              data,
              date: new Date().toISOString(),
            });
            Metrics.status.inc();
          } catch (error) {
            const date = new Date().toISOString();
            if (error instanceof PeerError) {
              this.statuses.push({
                enr,
                error: {
                  message: error.message,
                  code: error.code,
                },
                date,
              });
              Metrics.statusFailed.labels(error.code).inc();
            } else if (error instanceof Error) {
              this.statuses.push({
                enr,
                error: {
                  message: error.message,
                },
                date,
              });
              Metrics.statusFailed.labels('unknown').inc();
            }
          }
        });
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }
  }

  static async hydrater() {
    if (this.hydrateInterval) clearInterval(this.hydrateInterval);
    this.hydrateInterval = setInterval(() => this.hydrate(), REMOTE_GET_INTERVAL);
  }

  static async hydrate() {
    if (this.enrs.length > QUEUE_MAX_LIMIT) {
      logger.warn('queue max limit reached', {
        enrsCount: this.enrs.length,
        queueMaxLimit: QUEUE_MAX_LIMIT,
      });
      return;
    }
    try {
      this.hydrateAbortController = new AbortController();
      const res = await fetch(`${REMOTE_GET_ENDPOINT}?count=${REMOTE_GET_COUNT}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(SHARED_SECRET && { Authorization: `Basic ${SHARED_SECRET}` }),
        },
        signal: this.hydrateAbortController?.signal,
      });
      if (!res.ok) throw new Error(`status code ${res.status}`);
      const json = (await res.json()) as string[];
      Metrics.remoteGets.inc();
      Metrics.remoteGetENRs.inc(json.length);
      this.enrs.push(...json);
    } catch (error) {
      if (error instanceof Error) {
        logger.error('get error', {
          error: error.toString(),
          stack: error.stack,
        });
      }
      Metrics.remoteGetsFailed.inc();
    }
  }

  static async sender() {
    if (this.sendInterval) clearInterval(this.sendInterval);
    this.sendInterval = setInterval(() => this.send(), REMOTE_SEND_INTERVAL);
  }

  static async send() {
    const statuses = this.statuses.splice(0);
    if (statuses.length) {
      try {
        this.sendAbortController = new AbortController();
        const res = await fetch(REMOTE_SEND_ENDPOINT, {
          method: 'post',
          body: JSON.stringify(statuses),
          headers: {
            'Content-Type': 'application/json',
            ...(SHARED_SECRET && { Authorization: `Basic ${SHARED_SECRET}` }),
          },
          signal: this.sendAbortController?.signal,
        });
        if (!res.ok) throw new Error(`status code ${res.status}`);
        Metrics.remoteSends.inc();
        Metrics.remoteSendStatuses.inc(statuses.length);
      } catch (error) {
        if (error instanceof Error) {
          logger.error('send error', {
            error: error.toString(),
            stack: error.stack,
            statusesCount: statuses.length,
          });
        }
        Metrics.remoteSendsFailed.inc();
      }
    }
  }

  static async shutdown() {
    this.started = false;
    this.hydrateAbortController?.abort();
    this.sendAbortController?.abort();
    if (this.hydrateInterval) clearInterval(this.hydrateInterval);
    if (this.sendInterval) clearInterval(this.sendInterval);
  }
}
