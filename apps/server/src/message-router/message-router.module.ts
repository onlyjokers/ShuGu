import { Module } from '@nestjs/common';
import { MessageRouterService } from './message-router.service.js';

@Module({
    providers: [MessageRouterService],
    exports: [MessageRouterService],
})
export class MessageRouterModule { }
