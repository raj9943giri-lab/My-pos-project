import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * PART 5 — notification ढाँचा. Service export है क्योंकि orders और
 * public-store module अपने order-transaction के अंदर ही enqueue() बुलाते हैं.
 * drain() को main.ts का scheduler चलाता है (CMMIT-के-बाद-भेजने का नियम).
 */
@Module({
  imports: [DbModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
