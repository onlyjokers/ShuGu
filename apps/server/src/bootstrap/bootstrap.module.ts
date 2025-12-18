import { Module } from '@nestjs/common';
import { BootstrapController } from './bootstrap.controller.js';
import { BootstrapService } from './bootstrap.service.js';
import { GeoModule } from '../geo/geo.module.js';

@Module({
  imports: [GeoModule],
  controllers: [BootstrapController],
  providers: [BootstrapService],
})
export class BootstrapModule {}

