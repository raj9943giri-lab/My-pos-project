import 'reflect-metadata';
import * as path from 'path';
import * as express from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { env, isDev } from './config/env';
import { DbService } from './db/db.service';
import { runMigrations } from './db/migrator';
import { NotificationsService } from './notifications/notifications.service';

async function bootstrap() {
  // असली सर्वर start होने से पहले सख्त जाँच — jest e2e को import-time skip चाहिए इसलिए
  // ye जाँच env.ts में नहीं, यहाँ है (कोई DB जोड़ने से पहले fail fast)।
  if (!env.DATABASE_URL) {
    console.error('[pos-api] DATABASE_URL खाली है — .env बनाओ/.env.example देखो. (jest में ye auto-skip के लिए इजाज़त है)');
    process.exit(1);
  }
  if (env.JWT_SECRET === 'dev-only-insecure-secret-0123456789abcdef' && env.NODE_ENV !== 'test') {
    console.error('[pos-api] JWT_SECRET सेट नहीं है — असली सर्वर के लिए .env में रखो.');
    process.exit(1);
  }
  if (env.ADMIN_PASSWORD_MISSING && env.NODE_ENV !== 'test') {
    console.error('[pos-api] ADMIN_PASSWORD नहीं मिला — .env में रखो.');
    process.exit(1);
  }

  // Migrations pehle (database/migrations/*.sql, idempotent).
  const db = new DbService();
  try {
    await runMigrations(db);
  } finally {
    await db.pool.end().catch(() => undefined);
  }

  const allowedOrigins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [env.PUBLIC_SHOP_ORIGIN];

  const app = await NestFactory.create(AppModule, {
    // PART 8 — production में सिर्फ़ configured origins; dev में file:// /
    // localhost WebView के लिए खुला. Credentials नहीं (Bearer token header से).
    cors: {
      origin: (origin, cb) => {
        if (!origin || isDev) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('CORS origin not allowed: ' + origin), false);
      },
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    },
  });

  // Uploaded shop media serve (public GET; URLs = MEDIA_URL_BASE ... /media/…)
  app.use('/media', express.static(env.UPLOAD_DIR, { fallthrough: false }));

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,               // अनजान फ़ील्ड हटे (approval_status फ़िल्टर भी होता है)
    forbidNonWhitelisted: false,
    transform: true,
  }));

  await app.listen(env.PORT);
  console.log('[pos-api] ready on port', env.PORT, '· NODE_ENV=' + env.NODE_ENV,
    '· SMS=' + env.SMS_PROVIDER, '· push=' + (env.FCM_SERVER_KEY ? 'FCM' : 'in-app-only'),
    '· public=' + env.PUBLIC_SHOP_ORIGIN);

  // PART 5 — notification outbox drain (COMMIT-के-बाद-भेजना). हर ~20 s;
  // FCM key नहीं होगी भी तो drain in-app इतिहास जमा करता है (साफ़ note के साथ).
  const notifier = app.get(NotificationsService);
  const every = Math.min(Math.max(env.NOTIFIER_INTERVAL_MS, 5000), 300000);
  const timer = setInterval(() => {
    notifier.drain(20).catch((e) => console.error('[notifier] drain failed:', e && e.message));
  }, every);
  (timer as any).unref?.();
  console.log('[notifier] outbox drain हर ' + Math.round(every / 1000) + 's = ' + (env.FCM_SERVER_KEY ? 'FCM push तैयार' : 'in-app-only'));
}

bootstrap().catch((e) => {
  console.error('[pos-api] bootstrap failed:', e);
  process.exit(1);
});
