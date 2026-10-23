import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const Str = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s === '' ? undefined : s;
  });

/** POST /notifications/device-tokens — { token, platform? }. */
export class DeviceTokenDto {
  @Transform(({ value }: { value: unknown }) => String(value ?? '').trim())
  @IsString() @MinLength(20) @MaxLength(250)
  token!: string;

  @IsOptional() @Str() @IsIn(['ANDROID', 'IOS', 'WEB'])
  platform?: string;
}
