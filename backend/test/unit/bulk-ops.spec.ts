import { classifyStockItem, coerceIds, MAX_BULK_ITEMS } from '../../src/bulk-operations/bulk';

describe('coerceIds (bulk id lists)', () => {
  it('accepts numbers and form strings, dedupes', () => {
    expect(coerceIds([1, '2', 2, '1'])).toEqual([1, 2]);
  });
  it('drops junk ids (0, negative, NaN)', () => {
    expect(coerceIds([0, -3, 'abc', null, undefined, 5])).toEqual([5]);
  });
  it('caps the list length', () => {
    const many = Array.from({ length: 500 }, (_, i) => i + 1);
    expect(coerceIds(many)).toHaveLength(MAX_BULK_ITEMS);
  });
  it('non-array input yields an empty list', () => {
    expect(coerceIds('5' as any)).toEqual([]);
    expect(coerceIds(undefined)).toEqual([]);
  });
});

describe('classifyStockItem (bulk stock plan, DB-free)', () => {
  it('classifies a missing row', () => {
    const r = classifyStockItem(null, { id: 7, delta: 3 });
    expect(r).toEqual({ id: 7, status: 'missing', delta: 0, before: 0, after: 0 });
  });
  it('marks a real change as updated (delta honoured)', () => {
    const r = classifyStockItem(10, { id: 1, delta: -3 });
    expect(r.status).toBe('updated');
    expect(r.before).toBe(10);
    expect(r.after).toBe(7);
    expect(r.delta).toBe(-3);
  });
  it('absolute stock wins over delta', () => {
    const r = classifyStockItem(10, { id: 2, delta: 5, stock: 4 });
    expect(r).toMatchObject({ status: 'updated', before: 10, after: 4, delta: -6 });
  });
  it('stock can never go negative', () => {
    const r = classifyStockItem(2, { id: 3, delta: -9 });
    expect(r.after).toBe(0);
    expect(r.status).toBe('updated');
  });
  it('a no-op marks the item unchanged (nothing written)', () => {
    expect(classifyStockItem(4, { id: 4, delta: 0 }).status).toBe('unchanged');
    expect(classifyStockItem(4, { id: 4, stock: 4 }).status).toBe('unchanged');
  });
  it('fractional form inputs are rounded to whole units', () => {
    expect(classifyStockItem(3, { id: 5, stock: '2.7' as any }).after).toBe(3);
    expect(classifyStockItem(3, { id: 5, stock: '2.2' as any }).after).toBe(2);
  });
});
