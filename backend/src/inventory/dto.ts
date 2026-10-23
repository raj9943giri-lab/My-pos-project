import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

const Num = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  });

/** GET /inventory/movements?productId=&limit= */
export class ListMovementsQueryDto {
  @IsOptional() @Num() @IsInt() @Min(1)
  productId?: number;

  @IsOptional() @Num() @IsInt() @Min(1) @Max(100)
  limit?: number;
}
