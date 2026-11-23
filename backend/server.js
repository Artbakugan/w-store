const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { openDatabase } = require('./db');
const { openPostgresDatabase } = require('./postgresDatabase');
const { createItemRouter } = require('./api/itemRoutes');
const { SqliteItemRepository } = require('./service/sqliteItemRepository');
const { PostgresItemRepository } = require('./service/postgresItemRepository');
const { ItemService, ApiError } = require('./service/itemService');

const serverErrors = {
  429: ['too_many_requests', 'RATE_LIMIT_EXCEEDED'],
  500: ['internal_error', 'UNEXPECTED_ERROR'],
  502: ['bad_gateway', 'BAD_GATEWAY'],
  503: ['service_unavailable', 'UNAVAILABLE'],
  504: ['gateway_timeout', 'GATEWAY_TIMEOUT'],
};

function createRateLimiter({ windowMs = 10_000, maxRequests = 8, now = Date.now } = {}) {
  const buckets = new Map();
  let nextCleanup = 0;

  return (req, res, next) => {
    const timestamp = now();
    if (timestamp >= nextCleanup) {
      for (const [ip, bucket] of buckets) {
        if (bucket.expiresAt <= timestamp) buckets.delete(ip);
      }
      nextCleanup = timestamp + windowMs;
    }

    const ip = req.ip;
    let bucket = buckets.get(ip);
    if (!bucket || bucket.expiresAt <= timestamp) {
      bucket = { count: 0, expiresAt: timestamp + windowMs };
      buckets.set(ip, bucket);
    }
    if (bucket.count >= maxRequests) {
      res.set('Retry-After', String(Math.ceil((bucket.expiresAt - timestamp) / 1000)));
      return next(new ApiError(429, ...serverErrors[429]));
    }

    bucket.count++;
    next();
  };
}

function createApp(db, {
  demoFaults = false,
  rateLimit,
  itemRepository = new SqliteItemRepository(db),
  checkDatabase,
  trustProxy = false,
} = {}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  const itemService = new ItemService(itemRepository);

  app.use((req, res, next) => {
    req.rid = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', req.rid);
    next();
  });
  app.use(cors({ exposedHeaders: ['X-Request-Id', 'Retry-After'] }));

  app.get('/', (_req, res) => res.send('API W Store працює'));
  app.get('/health', async (_req, res) => {
    try {
      await checkDatabase?.();
    } catch {
      throw new ApiError(503, ...serverErrors[503]);
    }
    res.json({ status: 'ok' });
  });
  app.get('/catalog', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));
  app.get(['/resilience.js', '/catalog/resilience.js'], (_req, res) => res.sendFile(path.join(__dirname, '../frontend/resilience.js')));

  if (demoFaults) {
    app.use('/items', async (req, res, next) => {
      const fault = req.get('X-Demo-Fault');
      if (fault === 'timeout') {
        await delay(1300);
        if (res.destroyed) return;
        throw new ApiError(504, ...serverErrors[504]);
      }

      if (['429', '500', '502', '503', '504'].includes(fault)) {
        if (fault === '429' || fault === '503') res.set('Retry-After', '1');
        throw new ApiError(Number(fault), ...serverErrors[fault]);
      }

      next();
    });
  }

  app.use('/items', createRateLimiter(rateLimit), express.json(), createItemRouter(itemService));
  app.use((_req, _res, next) => next(new ApiError(404, 'not_found', 'ROUTE_NOT_FOUND')));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    let error = err;
    if (!(err instanceof ApiError)) {
      if (err.type === 'entity.parse.failed') {
        error = new ApiError(400, 'invalid_json', 'INVALID_JSON');
      } else if (err.status >= 400 && err.status < 500) {
        error = new ApiError(err.status, 'request_error', 'INVALID_REQUEST');
      } else {
        console.error(`[${req.rid}]`, err);
        error = new ApiError(500, ...serverErrors[500]);
      }
    }

    res.status(error.status).json({
      error: error.error,
      code: error.code,
      details: error.details,
      requestId: req.rid,
    });
  });

  return app;
}

async function startServer() {
  const driver = process.env.W_STORE_DB ?? 'sqlite';
  const port = Number(process.env.PORT ?? 3000);
  const options = {
    demoFaults: process.env.W_STORE_DEMO_FAULTS === '1',
    trustProxy: process.env.W_STORE_TRUST_PROXY === '1' ? 1 : false,
  };

  let db;
  let closeDatabase;
  if (driver === 'postgres') {
    db = await openPostgresDatabase();
    options.itemRepository = new PostgresItemRepository(db);
    options.checkDatabase = () => db.query({ text: 'SELECT 1', query_timeout: 2500 });
    closeDatabase = () => db.end();
  } else if (driver === 'sqlite') {
    db = await openDatabase();
    closeDatabase = () => new Promise((resolve, reject) => {
      db.close((error) => error ? reject(error) : resolve());
    });
  } else {
    throw new Error(`Невідоме значення W_STORE_DB: ${driver}`);
  }

  const server = createApp(db, options).listen(port, () => {
    console.log(`Сервер W Store (${driver}) запущено на порту ${server.address().port}`);
  });

  const stop = () => server.close(() => {
    closeDatabase().catch((error) => {
      console.error('Не вдалося закрити базу даних:', error);
      process.exitCode = 1;
    });
  });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Не вдалося запустити W Store:', err);
    process.exitCode = 1;
  });
}

module.exports = { createApp };
