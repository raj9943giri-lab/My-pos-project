import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { ShopsController } from './shops.controller';
import { ShopsService } from './shops.service';
import { SlugService } from './slug.service';

@Module({
  imports: [DbModule],
  controllers: [ShopsController],
  providers: [ShopsService, SlugService],
})
export class ShopsModule {}
