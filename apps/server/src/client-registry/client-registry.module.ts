import { Module, Global } from '@nestjs/common';
import { ClientRegistryService } from './client-registry.service.js';

@Global()
@Module({
    providers: [ClientRegistryService],
    exports: [ClientRegistryService],
})
export class ClientRegistryModule { }
