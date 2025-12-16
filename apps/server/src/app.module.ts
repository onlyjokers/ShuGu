import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { EventsModule } from './events/events.module.js';
import { ClientRegistryModule } from './client-registry/client-registry.module.js';
import { MessageRouterModule } from './message-router/message-router.module.js';
import { GeoModule } from './geo/geo.module.js';

@Module({
    imports: [
        EventsModule,
        ClientRegistryModule,
        MessageRouterModule,
        GeoModule,
    ],
    controllers: [AppController],
})
export class AppModule { }
