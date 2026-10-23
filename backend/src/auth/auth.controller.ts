import { Body, Controller, HttpException, Post, Request, UseGuards, Get, SetMetadata, UseFilters } from '@nestjs/common';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { OtpRequestDto, OtpVerifyDto, RegisterDto } from './dto';
import { normalizeDigits } from '../common/phone';
import { AuthGuard } from '../common/guards';
import { AllExceptionsFilter } from '../common/http-exception.filter';

@UseFilters(AllExceptionsFilter)
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private otps: OtpService) {}

  /** POST /auth/register { name, phone } */
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.name, dto.phone);
  }

  /** POST /auth/otp/request { phone } → { ok, ttlSec, devCode? (DEV ONLY) } */
  @Post('otp/request')
  async otpRequest(@Body() dto: OtpRequestDto) {
    const digits = normalizeDigits(dto.phone);
    return this.otps.request(digits!, 'LOGIN'); // devCode only when dev + console provider
  }

  /** POST /auth/otp/verify { phone, code } → { token, user, shop } */
  @Post('otp/verify')
  async otpVerify(@Body() dto: OtpVerifyDto) {
    const digits = normalizeDigits(dto.phone)!;
    await this.otps.verify(digits, dto.code);
    return this.auth.issueTokenAfterVerify(digits);
  }

  /** GET /auth/me (auth) */
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Request() req: { user: { id: string } }) {
    return this.auth.me(req.user.id);
  }
}
