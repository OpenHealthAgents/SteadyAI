import multipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'fs';
import path from 'path';

import { env } from './config/env';
import { disconnectPrisma } from './db/prisma';
import { appsMcpRoutes } from './routes/apps-mcp';
import { registerRoutes } from './routes';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: env.NODE_ENV !== 'test' });

  // Register CORS
  await app.register(cors, {
    origin: true, // Allow all origins in development
    credentials: true
  });

  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 5
    }
  });
  await app.register(formbody);

  // Some MCP clients probe with application/octet-stream while still sending JSON.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) {
      done(null, {});
      return;
    }

    try {
      done(null, JSON.parse(text));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.addHook('onClose', async () => {
    await disconnectPrisma();
  });

  // Root health check endpoint
  app.get('/', async () => {
    return { status: 'ok', message: 'SteadyAI Backend is running' };
  });

  app.get('/.well-known/openai-apps-challenge', async (request, reply) => {
    if (!env.OPENAI_APPS_CHALLENGE_TOKEN.trim()) {
      return reply.status(404).send({ error: 'Challenge token not configured' });
    }

    reply.type('text/plain; charset=utf-8');
    return reply.status(200).send(env.OPENAI_APPS_CHALLENGE_TOKEN.trim());
  });

  app.get('/media/exercises/:asset', async (request, reply) => {
    const rawAsset = (request.params as { asset?: string }).asset ?? '';
    const asset = path.basename(rawAsset);
    const mediaPath = path.join(process.cwd(), 'exercise-media', asset);

    if (!asset || !existsSync(mediaPath)) {
      return reply.status(404).send({ error: 'Exercise media not found' });
    }

    if (asset.endsWith('.gif')) {
      reply.type('image/gif');
    } else if (asset.endsWith('.mp4')) {
      reply.type('video/mp4');
    } else {
      reply.type('application/octet-stream');
    }

    return reply.send(createReadStream(mediaPath));
  });

  await app.register(appsMcpRoutes);
  await app.register(registerRoutes, { prefix: '/api' });

  return app;
}
