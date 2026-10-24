/** PART 4 — shared types: सर्वर-सत्यापित आकार ही विश्वसनीय हैं. */
/* PART 5 — OrderView में स्थिति टाइमलाइन + reason + canCancel जुड़े. */

export interface PublicShopInfo {
  name: string;
  slug: string;
  emoji: string;
  description: string | null;
  address: string | null;
  pincode: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  openTime: string;
  closeTime: string;
  isOpen: boolean;
  acceptingOrders: boolean;
  contact: string | null;
  delivery: boolean;
  pickup: boolean;
  minOrder: number;
  etaNote: string | null;
  paymentMethods: ('COD' | 'PON' | 'UPI_QR')[];
}

export interface ShopResponse {
  shop: PublicShopInfo;
  og: { title: string; description: string; url: string; type: string; image: string | null };
  note: string;
}

export interface CategoryChip {
  id: string;
  name: string;
  emoji: string;
  available: number;
}

export interface PublicProduct {
  id: string;
  name: string;
  unit: string;
  price: number;
  mrp: number | null;
  stock: number;
  photoUrl: string | null;
  brand: string | null;
  fresh: string | null;
  life: string | null;
  categoryId: string | null;
  category: string;
  /** सिर्फ़ product-detail response में */
  available?: boolean;
  variants?: Variant[];
}

export interface Variant {
  id: string;
  name: string;
  price: number | null;
  stock: number | null;
}

export interface ProductListResponse {
  shop: string;
  items: PublicProduct[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface ServerLine {
  productId: number;
  variantId: number | null;
  name: string;
  variantName: string | null;
  unit: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  stock: number;
  status: 'OK' | 'OUT' | 'LOW' | 'MISSING';
}

export interface Totals {
  subTotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
}

export interface ValidateResponse {
  shop: string;
  fulfilment: 'DELIVERY' | 'PICKUP';
  lines: ServerLine[];
  coupon: { code: string; amount: number } | null;
  totals: Totals;
  delivery: { available: boolean; etaNote: string | null; feeRule: { fee: number; freeAbove: number } };
  pickup: boolean;
  minOrder: { value: number; met: boolean };
  acceptOrders: boolean;
  ok: boolean;
}

export interface OrderSummary {
  id: number;
  number: string;
  publicToken: string;
  status: 'NEW' | 'ACCEPTED' | 'PREPARING' | 'PREPARED' | 'TRANSIT' | 'DELIVERED' | 'REJECTED' | 'CANCELLED' | string;
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | string;
  paymentMode: 'COD' | 'PON' | 'UPI_QR' | string;
  fulfilment: 'DELIVERY' | 'PICKUP';
  etaNote?: string;
  totals: Totals;
  coupon: { code: string; amount: number } | null;
  placedAt?: string;
  upiVpa: string | null;
  shop: { name: string; slug: string; contact: string | null };
}

export interface CheckoutResponse {
  duplicate: boolean;
  order: OrderSummary;
}

/** ग्राहक को दिखने वाली टाइमलाइन — केवल status + समय + reason (actor नहीं). */
export interface OrderHistoryStep {
  status: string;
  reason: string | null;
  createdAt: string;
}

export interface OrderViewResponse {
  order: {
    number: string;
    token: string;
    status: string;
    paymentStatus: string;
    paymentMode: string;
    fulfilment: 'DELIVERY' | 'PICKUP';
    totals: Totals;
    couponCode: string | null;
    placedAt: string;
    upiVpa: string | null;
    cancellationReason: string | null;
    cancelledAt: string | null;
    /** सिर्फ़ NEW (बाकी पुष्टि) ऑर्डर ही ग्राहक रद्द कर सकता है. */
    canCancel: boolean;
  };
  history: OrderHistoryStep[];
  pickup: { address: string | null } | null;
  shop: { name: string; slug: string; emoji?: string; contact: string | null };
  items: { name: string; variantName?: string | null; unit: string; qty: number; unitPrice: number }[];
}
