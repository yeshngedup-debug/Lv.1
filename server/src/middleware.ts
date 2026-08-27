import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { requestMetricsMiddleware } from './metrics.ts';

export function buildCorsOrigins(): boolean | string[] {
  return config.corsOrigin === '*'
    ? true
    : config.corsOrigin
      ? config.corsOrigin.split(',').map((o) => o.trim())
      : false;
}

export const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX) || 30,
  message: { error: 'Too many uploads, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

export function applySecurityMiddleware(app: Express): void {
  // Strict CSP only in production: dev needs Vite HMR (eval + ws), prod does not
  app.use(
    helmet({
      contentSecurityPolicy:
        config.nodeEnv === 'production'
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", 'https://fonts.googleapis.com'],
                fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
                imgSrc: ["'self'", 'data:', 'blob:'],
                mediaSrc: ["'self'", 'blob:'],
                connectSrc: ["'self'", 'ws:', 'wss:'],
                workerSrc: ["'self'", 'blob:'],
                frameAncestors: ["'none'"],
              },
            }
          : false,
      crossOriginEmbedderPolicy:
        config.nodeEnv === 'production' ? { policy: 'require-corp' } : false,
      crossOriginOpenerPolicy:
        config.nodeEnv === 'production' ? { policy: 'same-origin' } : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // CORS configuration - locked down in production
  app.use(
    cors({
      origin: buildCorsOrigins(),
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  // Global per-IP rate limit (in-memory; one instance per Render free service)
  app.use(
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMaxRequests,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.ip as string,
    }),
  );

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Trust the reverse proxy (Render) so req.protocol/host reflect public URLs
  app.set('trust proxy', 1);

  // Stricter budget for the API surface
  app.use(
    '/api/',
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMaxRequests,
      message: { error: 'Too many requests, please try again later' },
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // Request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('HTTP Request', {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
      });
    });
    next();
  });

  // HTTP request metrics
  app.use(requestMetricsMiddleware);
}
