import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway.js';
import { MessageRouterModule } from '../message-router/message-router.module.js';

@Module({
    imports: [MessageRouterModule],
    providers: [EventsGateway],
})
export class EventsModule { }
