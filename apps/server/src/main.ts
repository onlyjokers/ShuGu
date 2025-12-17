import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  // Check if certificates exist
  const keyCandidates = [
    path.join(process.cwd(), 'secrets/privkey.pem'),
    path.join(process.cwd(), 'secrets/key.pem'),
  ];
  const certCandidates = [path.join(process.cwd(), 'secrets/cert.pem')];
  const keyPath = keyCandidates.find((p) => fs.existsSync(p));
  const certPath = certCandidates.find((p) => fs.existsSync(p));
  let httpsOptions: any = undefined;

  if (keyPath && certPath) {
    httpsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
    console.log('🔒 HTTPS enabled');
  } else {
    console.warn('⚠️ No SSL certificates found, falling back to HTTP');
  }

  const appOptions: any = {
    cors: {
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      credentials: true,
    },
  };

  if (httpsOptions) {
    appOptions.httpsOptions = httpsOptions;
  }

  const app = await NestFactory.create(AppModule, appOptions);

  const port = process.env.PORT || 3001;
  const protocol = httpsOptions ? 'https' : 'http';

  await app.listen(port, '0.0.0.0'); // Listen on all interfaces
  console.log(`🚀 Server running on ${protocol}://localhost:${port}`);
  console.log(`📡 WebSocket ready for connections`);
}

bootstrap();
