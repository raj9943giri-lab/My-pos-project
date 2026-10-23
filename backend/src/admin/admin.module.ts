import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminUsersService } from './admin-users.service';
import { PoliciesService } from './policies.service';

/**
 * PART 7 — Admin Panel backend: auth (login/bootstrap), shop review workflow,
 * complaints के admin routes अलग ComplaintsModule में हैं; यहाँ दुकानें, पॉलिसी,
 * एडमिन अकाउंट व ऑडिट. RolesGuard को DbService चाहिए — इसलिए DbModule.
 */
@Module({
  imports: [DbModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAuthService, AdminUsersService, PoliciesService],
  exports: [AdminService, PoliciesService],
})
export class AdminModule {}
