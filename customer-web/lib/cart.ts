/**
 * PART 4 — client cart (single global cart, one shop at a time).
 *
 * कॉपी हर रिफ्रेश पर बची रहती है (localStorage). दूसरी दुकान का सामान कभी silently
 * नहीं मिलाया जाता — add() का जवाब needsSwitch देता है, UI पूछकर कार्ट खाली करता है.
 */
import type { PublicProduct, Variant } from './types';

export interface CartItem {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  unit: string;
  price: number;           // पहले से देखी कीमत (server ही अंतिम सच है)
  qty: number;
  photoUrl: string | null;
}

export interface Cart {
  shopSlug: string;
  items: CartItem[];
}

const KEY = 'sos_cart.v2';
const MAX_QTY = 99;

const isBrowser = () => typeof window !== 'undefined';

export function readCart(): Cart | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cart;
    if (c && c.shopSlug && Array.isArray(c.items)) return c;
  } catch {
    /* खराब JSON → खाली कार्ट मानो (कार्ट ज़रूरत में दोबारा बनती है) */
  }
  return null;
}

export function writeCart(cart: Cart | null): void {
  if (!isBrowser()) return;
  if (!cart || !cart.items.length) window.localStorage.removeItem(KEY);
  else window.localStorage.setItem(KEY, JSON.stringify(cart));
}

export function itemCount(): number {
  const c = readCart();
  return c ? c.items.reduce((s, i) => s + i.qty, 0) : 0;
}

export function clearCart(): void {
  if (isBrowser()) window.localStorage.removeItem(KEY);
}

export function itemKey(productId: string, variantId: string | null): string {
  return productId + ':' + (variantId || '');
}

export interface AddOutcome {
  added: boolean;
  /** असली अवरोध: कार्ट किसी और दुकान का है (UI उपयोगकर्ता से पूछकर खाली करता है) */
  needsSwitch: boolean;
  /** इस आइटम का कार्ट उपलब्धता (सर्वर बाद में ही पक्का करता है) */
  qty: number;
}

/** Simple add — कार्ट उसी दुकान का है मानकर. दूसरी दुकान पर needsSwitch=true. */
export function attemptAdd(slug: string, product: PublicProduct, variant: Variant | null, qty: number): AddOutcome {
  const cart = readCart();
  if (cart && cart.shopSlug !== slug) {
    return { added: false, needsSwitch: true, qty: 0 };
  }
  const cartOk: Cart = cart || { shopSlug: slug, items: [] };
  const q = Math.max(1, Math.min(MAX_QTY, Math.round(Number(qty) || 1)));
  const key = itemKey(product.id, variant?.id || null);
  const found = cartOk.items.find((i) => itemKey(i.productId, i.variantId) === key);
  if (found) found.qty = Math.min(MAX_QTY, found.qty + q);
  else {
    cartOk.items.push({
      productId: product.id,
      variantId: variant?.id || null,
      name: product.name,
      variantName: variant?.name || null,
      unit: product.unit,
      price: variant?.price ?? product.price,
      qty: q,
      photoUrl: product.photoUrl,
    });
  }
  writeCart(cartOk);
  return { added: true, needsSwitch: false, qty: q };
}

/** सर्वर की सत्यापित qty adopt करलो (clamp बाद) — price/stock warnings के साथ. */
export function setQty(productId: string, variantId: string | null, qty: number): void {
  const cart = readCart();
  if (!cart) return;
  const key = itemKey(productId, variantId);
  const item = cart.items.find((i) => itemKey(i.productId, i.variantId) === key);
  if (!item) return;
  const n = Math.max(0, Math.min(MAX_QTY, Math.round(Number(qty) || 0)));
  if (n === 0) cart.items = cart.items.filter((i) => itemKey(i.productId, i.variantId) !== key);
  else item.qty = n;
  writeCart(cart);
}

export function removeItem(productId: string, variantId: string | null): void {
  setQty(productId, variantId, 0);
}

/** SwitchShop बाद — पुराना कार्ट सर्फ़ उपयोगकर्ता की साफ़ सहमति से ही जाता है. */
export function startCartFor(slug: string): void {
  writeCart({ shopSlug: slug, items: [] });
}
