import { Controller, Get } from '@nestjs/common';
import { ClientRegistryService } from './client-registry/client-registry.service.js';

@Controller()
export class AppController {
    constructor(private readonly clientRegistry: ClientRegistryService) { }

    @Get('health')
    health() {
        return {
            status: 'ok',
            timestamp: Date.now(),
            uptime: process.uptime(),
        };
    }

    @Get('clients')
    getClients() {
        return {
            clients: this.clientRegistry.getAllClients(),
            managers: this.clientRegistry.getAllManagers(),
            count: {
                clients: this.clientRegistry.getClientCount(),
                managers: this.clientRegistry.getManagerCount(),
            },
        };
    }

    @Get('time')
    getServerTime() {
        return {
            serverTimestamp: Date.now(),
        };
    }
}
