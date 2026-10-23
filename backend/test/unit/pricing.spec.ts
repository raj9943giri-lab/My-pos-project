import { applyPercent, nextStock, planBulkPrice, round2 } from '../../src/products/pricing';

describe('round2 (price rounding)', () => {
  it('rounds to 2 decimals without float noise', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(45.005)).toBe(45.01);
  });
  it('non-numeric input becomes 0 (never NaN)', () => {
    expect(round2('abc' as unknown as number)).toBe(0);
    expect(round2(NaN)).toBe(0);
  });
});

describe('applyPercent (single price change)', () => {
  it('raises the price by a percent', () => {
    expect(applyPercent(100, 10)).toBe(110);
  });
  it('discounts the price', () => {
    expect(applyPercent(100, -10)).toBe(90);
  });
  it('keeps 2 decimals', () => {
    expect(applyPercent(99.99, 10)).toBe(109.99);
  });
  it('never drops below the minimum price', () => {
    expect(applyPercent(10, -100, 1)).toBe(1);
    expect(applyPercent(10, -100, 5)).toBe(5);
  });
  it('a 0% change is a no-op', () => {
    expect(applyPercent(42.5, 0)).toBe(42.5);
  });
});

describe('planBulkPrice (preview — performs no writes)', () => {
  const rows = [
    { id: 1, name: 'आटा', price: 100 },
    { id: 2, name: 'चीनी', price: 50 },
  ];

  it('maps every row to a change', () => {
    const plan = planBulkPrice(rows, 10);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toEqual({ id: 1, name: 'आटा', oldPrice: 100, newPrice: 110 });
    expect(plan[1]).toEqual({ id: 2, name: 'चीनी', oldPrice: 50, newPrice: 55 });
  });

  it('discounts below the old price', () => {
    const plan = planBulkPrice(rows, -10);
    expect(plan[0].newPrice).toBe(90);
    expect(plan[1].newPrice).toBe(45);
  });

  it('clamps to the minimum price instead of going to zero', () => {
    const plan = planBulkPrice([{ id: 3, name: 'सस्ता', price: 2 }], -50, 1);
    expect(plan[0].newPrice).toBe(1);
  });

  it('an empty catalogue plans nothing', () => {
    expect(planBulkPrice([], 10)).toEqual([]);
  });
});

describe('nextStock (stock movement)', () => {
  it('applies a relative delta', () => {
    expect(nextStock(10, 5)).toBe(15);
    expect(nextStock(10, -3)).toBe(7);
  });
  it('stock can never go negative', () => {
    expect(nextStock(2, -5)).toBe(0);
    expect(nextStock(0, -1)).toBe(0);
  });
  it('an absolute value wins over the delta', () => {
    expect(nextStock(10, 5, 4)).toBe(4);
    expect(nextStock(10, -5, 4)).toBe(4);
  });
  it('rounds to whole units', () => {
    expect(nextStock(10, 1.4)).toBe(11);
  });
  it('a missing delta keeps the current stock', () => {
    expect(nextStock(10)).toBe(10);
  });
});
