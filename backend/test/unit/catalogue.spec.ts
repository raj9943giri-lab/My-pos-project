import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AdjustStockDto, BulkPriceDto, CreateProductDto, ListProductsQueryDto, UpdateProductDto,
} from '../../src/products/dto';
import { CreateProductCategoryDto, UpdateProductCategoryDto } from '../../src/product-categories/dto';

/**
 * PART 3 catalogue validation — the rules the merchant app has to satisfy
 * before the backend accepts a write. Same pipe options as main.ts.
 */
async function errorsFor(cls: any, payload: Record<string, unknown>) {
  const dto: any = plainToInstance(cls, payload);
  const errors = await validate(dto as object, { whitelist: true, forbidNonWhitelisted: false });
  // e.constraints keys are constraint TYPES (min, isIn…); the failing FIELD is e.property.
  return { dto, fields: errors.map((e) => e.property) };
}

describe('CreateProductDto', () => {
  it('accepts a minimal valid product', async () => {
    const { fields } = await errorsFor(CreateProductDto, { name: 'आटा', unit: '1 किलो', price: 45 });
    expect(fields).toEqual([]);
  });

  it('coerces form strings to numbers (HTML inputs send text)', async () => {
    const { dto, fields } = await errorsFor(CreateProductDto, {
      name: 'आटा', unit: '1 किलो', price: '45', stock: '23', lowAt: '5', categoryId: '3',
    });
    expect(fields).toEqual([]);
    expect(dto.price).toBe(45);
    expect(dto.stock).toBe(23);
    expect(dto.lowAt).toBe(5);
    expect(dto.categoryId).toBe(3);
  });

  it('rejects a name shorter than 2 characters', async () => {
    const { fields } = await errorsFor(CreateProductDto, { name: 'a', unit: '1 किलो', price: 45 });
    expect(fields).toContain('name');
  });

  it('rejects a missing unit', async () => {
    const { fields } = await errorsFor(CreateProductDto, { name: 'आटा', price: 45 });
    expect(fields).toContain('unit');
  });

  it('rejects a zero or negative price', async () => {
    expect((await errorsFor(CreateProductDto, { name: 'आटा', unit: '1 किलो', price: 0 })).fields).toContain('price');
    expect((await errorsFor(CreateProductDto, { name: 'आटा', unit: '1 किलो', price: -5 })).fields).toContain('price');
  });

  it('rejects negative stock', async () => {
    const { fields } = await errorsFor(CreateProductDto, { name: 'आटा', unit: '1 किलो', price: 45, stock: -1 });
    expect(fields).toContain('stock');
  });
});

describe('UpdateProductDto (PATCH — partial)', () => {
  it('accepts an empty patch', async () => {
    const { fields } = await errorsFor(UpdateProductDto, {});
    expect(fields).toEqual([]);
  });

  it('mrp: null clears the MRP (does not fail validation)', async () => {
    const { dto, fields } = await errorsFor(UpdateProductDto, { mrp: null });
    expect(fields).toEqual([]);
    expect(dto.mrp).toBeNull();
  });

  it('brand: null clears the brand', async () => {
    const { dto, fields } = await errorsFor(UpdateProductDto, { brand: '' });
    expect(fields).toEqual([]);
    expect(dto.brand).toBeNull();
  });

  it('a blank name is treated as "not provided" (not an error)', async () => {
    const { dto, fields } = await errorsFor(UpdateProductDto, { name: '   ' });
    expect(fields).toEqual([]);
    expect(dto.name).toBeUndefined();
  });

  it('still validates a provided price', async () => {
    const { fields } = await errorsFor(UpdateProductDto, { price: 0 });
    expect(fields).toContain('price');
  });
});

describe('AdjustStockDto', () => {
  it('accepts a delta', async () => {
    const { dto, fields } = await errorsFor(AdjustStockDto, { delta: -2 });
    expect(fields).toEqual([]);
    expect(dto.delta).toBe(-2);
  });

  it('accepts an absolute stock value', async () => {
    const { dto, fields } = await errorsFor(AdjustStockDto, { stock: '12' });
    expect(fields).toEqual([]);
    expect(dto.stock).toBe(12);
  });

  it('rejects a negative absolute stock', async () => {
    const { fields } = await errorsFor(AdjustStockDto, { stock: -1 });
    expect(fields).toContain('stock');
  });
});

describe('BulkPriceDto', () => {
  it('accepts a percent inside the allowed range', async () => {
    const { dto, fields } = await errorsFor(BulkPriceDto, { percent: '10' });
    expect(fields).toEqual([]);
    expect(dto.percent).toBe(10);
  });

  it('rejects a percent below -100', async () => {
    const { fields } = await errorsFor(BulkPriceDto, { percent: -101 });
    expect(fields).toContain('percent');
  });

  it('rejects a percent above 1000', async () => {
    const { fields } = await errorsFor(BulkPriceDto, { percent: 1001 });
    expect(fields).toContain('percent');
  });

  it('a preview flag is optional', async () => {
    const { dto, fields } = await errorsFor(BulkPriceDto, { percent: 5, preview: true });
    expect(fields).toEqual([]);
    expect(dto.preview).toBe(true);
  });
});

describe('ListProductsQueryDto', () => {
  it('accepts the documented filters', async () => {
    const { fields } = await errorsFor(ListProductsQueryDto, { q: 'आटा', stock: 'low', categoryId: '2' });
    expect(fields).toEqual([]);
  });

  it('rejects an unknown stock filter', async () => {
    const { fields } = await errorsFor(ListProductsQueryDto, { stock: 'weird' });
    expect(fields).toContain('stock');
  });
});

describe('product category DTOs', () => {
  it('accepts a valid category', async () => {
    const { fields } = await errorsFor(CreateProductCategoryDto, { name: 'किराना', emoji: '🧺' });
    expect(fields).toEqual([]);
  });

  it('rejects a 1-letter name', async () => {
    const { fields } = await errorsFor(CreateProductCategoryDto, { name: 'a' });
    expect(fields).toContain('name');
  });

  it('rejects an emoji longer than 8 characters', async () => {
    const { fields } = await errorsFor(CreateProductCategoryDto, { name: 'किराना', emoji: '123456789' });
    expect(fields).toContain('emoji');
  });

  it('a rename patch may be partial', async () => {
    const { fields } = await errorsFor(UpdateProductCategoryDto, { emoji: '🥛' });
    expect(fields).toEqual([]);
  });
});
