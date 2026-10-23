import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** form-string भी number बन जाए (पूरे backend की परिपाटी). */
const Num = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  });

const Str = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s === '' ? undefined : s;
  });

const REASON_MAX = 300;

/** Reject/cancel का वैकल्पिक reason — sensitive कुछ नहीं, status हिस्ट्री में जाता है. */
export class ReasonDto {
  @IsOptional() @Str() @IsString() @MaxLength(REASON_MAX)
  reason?: string;
}

/** POST /shops/:shopId/orders/:orderId/status — सिर्फ़ action, कोई status नहीं. */
export class StatusActionDto extends ReasonDto {
  @IsIn(['ACCEPT', 'REJECT', 'START_PREPARING', 'MARK_READY', 'OUT_FOR_DELIVERY', 'COMPLETE', 'CANCEL', 'MARK_PAID'],
    { message: 'मान्य काम चुनें (ACCEPT/REJECT/…)' })
  action!: string;
}

/** GET /shops/:shopId/orders?status=&date=&q=&page=&limit= */
export class ListOrdersQueryDto {
  @IsOptional() @IsIn(['NEW', 'ACCEPTED', 'PREPARING', 'PREPARED', 'TRANSIT', 'DELIVERED', 'REJECTED', 'CANCELLED', 'ALL', 'ACTIVE'],
    { message: 'status: NEW/ACCEPTED/…/ALL/ACTIVE' })
  status?: string;

  /** YYYY-MM-DD (यह दिन के ऑर्डर). */
  @IsOptional() @Transform(({ value }: { value: unknown }) => String(value ?? '').trim())
  @IsString()
  @MaxLength(10)
  date?: string;

  /** ऑर्डर नंबर / ग्राहक नाम / फ़ोन (अपनी ही दुकान की सूची में). */
  @IsOptional() @Str() @MaxLength(60)
  q?: string;

  @IsOptional() @Num() @IsInt() @Min(1) @Max(500)
  page?: number;

  @IsOptional() @Num() @IsInt() @Min(1) @Max(50)
  limit?: number;
}
