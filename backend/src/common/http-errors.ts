/** HTTP error factories (Hindi messages; consistent shape via filter). */
type Extra = Record<string, unknown>;

export function Http400(message: string, extra?: Extra) {
  return Object.assign(new Error(message), { status: 400, ...(extra || {}) });
}
export function Http401(message = 'ऑथेंटिकेशन ज़रूरी') {
  return Object.assign(new Error(message), { status: 401 });
}
export function Http403(message = 'यह दुकान आपकी नहीं है') {
  return Object.assign(new Error(message), { status: 403 });
}
export function Http404(message = 'नहीं मिला') {
  return Object.assign(new Error(message), { status: 404 });
}
export function Http409(message: string, extra?: Extra) {
  return Object.assign(new Error(message), { status: 409, ...(extra || {}) });
}
export function Http429(message: string, extra?: Extra) {
  return Object.assign(new Error(message), { status: 429, ...(extra || {}) });
}
