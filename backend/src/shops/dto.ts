import {
  ArrayMaxSize, IsArray, IsBoolean, IsLatitude, IsLongitude, IsNumber,
  IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf,
} from 'class-validator';
import { SLUG_RE } from '../common/slug';

export class CreateShopDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsString() @Matches(SLUG_RE, { message: 'slug 3-40 chars: a-z 0-9 - Devanagari' })
  slug!: string;

  @IsArray() @ArrayMaxSize(3)
  categoryIds!: string[];

  /** Agar license-required category chuni hai to licenseNo zaroori (service me check). */
  @IsOptional() @IsString() @MaxLength(40)
  licenseNo?: string;

  @IsOptional() @IsString() @MaxLength(200)
  address?: string;

  @IsOptional() @Matches(/^\d{6}$/)
  pin?: string;

  @IsOptional() @IsNumber() @IsLatitude()
  lat?: number;

  @IsOptional() @IsNumber() @IsLongitude()
  lng?: number;

  @ValidateIf((o) => o.whatsapp != null && o.whatsapp !== '')
  @Matches(/^\+\d{10,15}$/, { message: 'whatsapp normalized E.164 (e.g. +919876543210)' })
  whatsapp?: string;

  @IsOptional()
  @ValidateIf((o) => o.businessPhone != null && o.businessPhone !== '')
  @Matches(/^\+\d{10,15}$/, { message: 'businessPhone normalized E.164 (+91…)' })
  businessPhone?: string;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @IsOptional() @Matches(/^([0-1]?\d|2[0-3]):[0-5]\d$/)
  openTime?: string;

  @IsOptional() @Matches(/^([0-1]?\d|2[0-3]):[0-5]\d$/)
  closeTime?: string;

  @IsOptional() @IsBoolean()
  openAllWeek?: boolean;

  @IsOptional() @IsBoolean()
  pickup?: boolean;

  @IsOptional() @IsBoolean()
  delivery?: boolean;

  @IsOptional() @IsString() @MaxLength(4)
  emoji?: string;
}

export class UpdateShopDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  name?: string;

  @IsOptional() @IsString() @Matches(SLUG_RE)
  slug?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(3)
  categoryIds?: string[];

  @IsOptional() @IsString() @MaxLength(40)
  licenseNo?: string;

  @IsOptional() @IsString() @MaxLength(200)
  address?: string;

  @IsOptional() @Matches(/^\d{6}$/)
  pin?: string;

  @IsOptional() @IsNumber() @IsLatitude()
  lat?: number | null;

  @IsOptional() @IsNumber() @IsLongitude()
  lng?: number | null;

  @IsOptional() @ValidateIf((o) => o.whatsapp != null && o.whatsapp !== '')
  @Matches(/^\+\d{10,15}$/)
  whatsapp?: string;

  @IsOptional() @ValidateIf((o) => o.businessPhone != null && o.businessPhone !== '')
  @Matches(/^\+\d{10,15}$/)
  businessPhone?: string;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  @IsOptional() @Matches(/^([0-1]?\d|2[0-3]):[0-5]\d$/)
  openTime?: string;

  @IsOptional() @Matches(/^([0-1]?\d|2[0-3]):[0-5]\d$/)
  closeTime?: string;

  @IsOptional() @IsBoolean()
  openAllWeek?: boolean;

  @IsOptional() @IsBoolean()
  pickup?: boolean;

  @IsOptional() @IsBoolean()
  delivery?: boolean;

  @IsOptional() @IsString() @MaxLength(4)
  emoji?: string;
  // NOTE (security): approval_status / published yahan allowed NAHI — sirf
  // admin endpoint badal sakta hai. Global ValidationPipe(whitelist) baaqi fields
  // strip karta hai; controller bhi extra guard karta hai.
}

export class CheckSlugQueryDto {
  @IsString() @Matches(SLUG_RE)
  slug!: string;
}

export class SubmitApprovalDto {}
