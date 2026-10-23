import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { ShopScopeModule } from '../shop-scope/shop-scope.module';
import { AdminComplaintsController, PublicComplaintController, MerchantComplaintController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';

/** PART 7 — complaint filing (customer token / merchant member) + admin lifecycle. */
@Module({
  imports: [DbModule, ShopScopeModule],
  controllers: [AdminComplaintsController, PublicComplaintController, MerchantComplaintController],
  providers: [ComplaintsService],
  exports: [ComplaintsService],
})
export class ComplaintsModule {}
