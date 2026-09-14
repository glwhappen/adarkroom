import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { authRoutes } from './auth.js';
import { stateRoutes } from './routes.js';

const app = Fastify({ logger: true, trustProxy: true });

await app.register(cookie);
// 静态托管整个游戏（fork 仓库根目录：index.html / script/ / css/ / lang/ / audio/）
await app.register(fastifyStatic, { root: config.staticRoot, index: ['index.html'] });

await app.register(authRoutes);
await app.register(stateRoutes);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
