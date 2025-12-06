import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
    // Check if certificates exist
    const keyPath = path.join(process.cwd(), 'secrets/privkey.pem');
    const certPath = path.join(process.cwd(), 'secrets/cert.pem');
    let httpsOptions: any = undefined;

    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
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
