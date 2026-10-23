import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';

@Module({
  imports: [DbModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService],
})
export class AuthModule {}
