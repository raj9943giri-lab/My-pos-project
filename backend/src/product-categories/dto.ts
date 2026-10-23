import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** Trimmed string; blank -> undefined ("field not provided"). */
const Str = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s === '' ? undefined : s;
  });

/** POST /product-categories */
export class CreateProductCategoryDto {
  @Str() @IsString({ message: 'कैटेगरी का नाम ज़रूरी है' }) @MinLength(2) @MaxLength(60)
  name!: string;

  @IsOptional() @Str() @IsString() @MaxLength(8)
  emoji?: string;
}

/** PATCH /product-categories/:id */
export class UpdateProductCategoryDto {
  @IsOptional() @Str() @IsString() @MinLength(2) @MaxLength(60)
  name?: string;

  @IsOptional() @Str() @IsString() @MaxLength(8)
  emoji?: string;
}
