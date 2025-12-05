import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        cors: {
            origin: '*',
            methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
            credentials: true,
        },
    });

    const port = process.env.PORT || 3001;

    await app.listen(port);
    console.log(`🚀 Server running on http://localhost:${port}`);
    console.log(`📡 WebSocket ready for connections`);
}

bootstrap();
