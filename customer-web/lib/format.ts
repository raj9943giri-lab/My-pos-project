/** PART 4 — formatting helpers (INR पहले). */

const inrFmt = new Intl.NumberFormat('hi-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

/** ₹45.50 जैसा रूप — हमेशा रुपये (server totals ही सच). */
export function inr(n: number | null | undefined): string {
  const v = Number(n);
  if (!isFinite(v)) return inrFmt.format(0);
  return inrFmt.format(v);
}

export function productHref(slug: string, id: string): string {
  return `/s/${encodeURIComponent(slug)}/p/${encodeURIComponent(id)}`;
}

export function shopHref(slug: string): string {
  return `/s/${encodeURIComponent(slug)}`;
}

export const STATUS_HI: Record<string, string> = {
  NEW: 'ऑर्डर की पुष्टि बाकी है',
  ACCEPTED: 'ऑर्डर स्वीकार किया गया',
  PREPARING: 'सामान तैयार हो रहा है',
  PREPARED: 'सामान लेने/भेजने के लिए तैयार',
  TRANSIT: 'ऑर्डर डिलीवरी के लिए निकल चुका है',
  DELIVERED: 'ऑर्डर पूरा हो गया',
  REJECTED: 'दुकान ने ऑर्डर स्वीकार नहीं किया',
  CANCELLED: 'ऑर्डर रद्द कर दिया गया',
};

/** छोटी बैज-स्टाइल labels (टाइमलाइन के लिए). */
export const STATUS_SHORT_HI: Record<string, string> = {
  NEW: 'नया',
  ACCEPTED: 'स्वीकार',
  PREPARING: 'बन रहे',
  PREPARED: 'तैयार',
  TRANSIT: 'रास्ते में',
  DELIVERED: 'पूरा',
  REJECTED: 'स्वीकार नहीं हुआ',
  CANCELLED: 'रद्द',
};

export const PAY_STATUS_HI: Record<string, string> = {
  PENDING: 'बाक़ी',
  COD_PENDING: 'COD बाक़ी',
  PAID: 'चुका दिया',
  FAILED: 'असफल',
};

export const PAY_MODE_HI: Record<string, string> = {
  COD: 'कैश ऑन डिलीवरी',
  PON: 'दुकान पर भुगतान',
  UPI_QR: 'UPI (QR से मैन्युअल)',
};

/** "आज 20 अक्टू 2026, 5:30 PM" जैसा. */
export function whenHi(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('hi-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
