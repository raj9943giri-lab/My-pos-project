import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/** Numeric coercion (products/dto.ts जैसा — form-string भी चलें). */
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

/** GET /public/shops/:slug/products?… */
export class PublicProductQueryDto {
  @IsOptional() @Str() @MaxLength(120)
  q?: string;

  @IsOptional() @Num() @IsInt() @Min(1)
  categoryId?: number;

  /** 'name' (default) | 'price_asc' | 'price_desc' */
  @IsOptional() @IsIn(['name', 'price_asc', 'price_desc'])
  sort?: string;

  /** 'true' → सिर्फ़ जो stock में है. */
  @IsOptional() @IsIn(['true', 'false', '1', '0'])
  inStock?: string;

  @IsOptional() @Num() @IsInt() @Min(1) @Max(500)
  page?: number;

  @IsOptional() @Num() @IsInt() @Min(1) @Max(50)
  limit?: number;
}

/** सारे (validate/checkout) body items की — हर row एक product (या variant) + qty. */
export class CartItemDto {
  @Num() @IsInt({ message: 'productId ज़रूरी है' }) @Min(1)
  productId!: number;

  @IsOptional() @Num() @IsInt() @Min(1)
  variantId?: number;

  @Num() @IsInt({ message: 'qty ज़रूरी है' }) @Min(1, { message: 'qty कम से कम 1 हो' }) @Max(99)
  qty!: number;
}

/** Guest customer कौन (checkout body के भीतर) — CheckoutDto से पहले तय होना चाहिए
 * (field type metadata TDZ से बचाने के लिए, नीचे नहीं). */
export class GuestCustomerDto {
  @Str() @IsString({ message: 'नाम ज़रूरी है' }) @MinLength(2) @MaxLength(60)
  name!: string;

  @Str() @IsString({ message: 'मोबाइल नंबर ज़रूरी है' }) @MinLength(6) @MaxLength(20)
  phone!: string;
}

export class CartValidateDto {
  @IsArray({ message: 'items सूची ज़रूरी है' }) @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];

  @IsOptional() @Str() @MaxLength(40)
  couponCode?: string;

  @IsOptional() @IsIn(['DELIVERY', 'PICKUP'])
  fulfilment?: string;
}

/** POST /public/shops/:slug/checkout — असली order का body (guest checkout). */
export class CheckoutDto extends CartValidateDto {
  @ValidateNested()
  @Type(() => GuestCustomerDto)
  customer!: GuestCustomerDto;

  @IsOptional() @Str() @MaxLength(300)
  address?: string;

  @IsOptional() @Str() @MaxLength(120)
  landmark?: string;

  @IsOptional() @Str() @MaxLength(200)
  instructions?: string;

  /** COD | PON (pick-up par peymant) | UPI_QR (sirf configured VPA ho tab). */
  @IsIn(['COD', 'PON', 'UPI_QR'], { message: 'पेमेंट तरीका उपलब्ध विकल्पों में चुनें' })
  paymentMode!: 'COD' | 'PON' | 'UPI_QR';
}

/** ग्राहक cancel: { reason? } — ज़्यादा से ज़्यादा 300 अक्षर. */
export class OrderCancelDto {
  @IsOptional() @Str() @IsString() @MaxLength(300)
  reason?: string;
}

/** POST /shops/:slug (alpha build) के requireId जैसा — यहाँ सिर्फ़ ढाँचा. */
export class OrderTokenParamDto {
  @Str() @MaxLength(64)
  token!: string;
}
