import client from 'prom-client';
import type { Request, Response } from 'express';
import { logger } from './logger.ts';

export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'iris_' });

// Custom metrics (registered for future instrumentation points)
export const activeSessions = new client.Gauge({
  name: 'iris_active_sessions',
  help: 'Number of active sessions',
  registers: [register],
});
export const connectedPeers = new client.Gauge({
  name: 'iris_connected_peers',
  help: 'Number of connected peers',
  registers: [register],
});
export const iceConnectionState = new client.Counter({
  name: 'iris_ice_connection_state_total',
  help: 'ICE connection state changes',
  labelNames: ['state'],
  registers: [register],
});
export const negotiationDuration = new client.Histogram({
  name: 'iris_negotiation_duration_seconds',
  help: 'WebRTC negotiation duration',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});
export const httpRequests = new client.Counter({
  name: 'iris_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

export function requestMetricsMiddleware(req: Request, res: Response, next: () => void): void {
  const start = Date.now();
  res.on('finish', () => {
    httpRequests.inc({
      method: req.method,
      path: (req as any).route?.path || req.path,
      status: res.statusCode,
    });
  });
  next();
}

// Prometheus metrics endpoint - protected by token if configured
export async function metricsRoute(req: Request, res: Response): Promise<void> {
  const token = process.env.METRICS_TOKEN;
  if (token && req.headers['authorization'] !== `Bearer ${token}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (ex: any) {
    logger.error('Metrics error', { error: ex.message });
    res.status(500).end(ex.message);
  }
}
