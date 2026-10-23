import { IsMobilePhone, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

const digitsOnly = ({ value }: { value?: string }) => String(value || '').replace(/\D/g, '').slice(-10);

export class RegisterDto {
  @IsString() @Length(2, 60)
  name!: string;

  @Transform(digitsOnly)
  @IsMobilePhone('en-IN', { strictMode: false })
  phone!: string;
}

export class OtpRequestDto {
  @Transform(digitsOnly)
  @IsMobilePhone('en-IN', { strictMode: false })
  phone!: string;
}

export class OtpVerifyDto {
  @Transform(digitsOnly)
  @IsMobilePhone('en-IN', { strictMode: false })
  phone!: string;

  @Transform(({ value }: { value?: string }) => String(value || '').replace(/\D/g, ''))
  @Length(6, 6)
  code!: string;
}
