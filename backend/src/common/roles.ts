/* ============================================================================
   POS — PART 7 platform roles & status enums (single source of truth).
   ----------------------------------------------------------------------------
   यहीं तीनों enums रहते हैं और backend + frontend दोनों इन्हीं values को
   जानते हैं (DB CHECK constraints भी migration 008 में इन्हीं पर बँधे हैं):

     UserRole        — प्लेटफ़ॉर्म-स्तर की भूमिका (admin_users.role, users.role)
     ShopStatus      — shops.approval_status की साफ़ दुनिया (PENDING_APPROVAL
                       जैसी पुरानी वैल्यू migration 008 में PENDING हुई)
     ComplaintStatus — complaints.status जीवन-चक्र

   Permission matrix (pure functions — unit tested, DB-free):
     SUPER_ADMIN : सब कुछ (एडमिन्स, पॉलिसी, ऑडिट, दुकानें, शिकायतें)
     ADMIN       : दुकान अप्रूवल + शिकायतें + पॉलिसी + ऑडिट; एडमिन्स नहीं
     SUPPORT     : शिकायतें (पूरा जीवन-चक्र) + दुकानें सिर्फ़ पढ़ना
     MERCHANT    : admin panel का रास्ता नहीं — merchant JWT अलग दुनिया है
   ========================================================================== */

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  SUPPORT = 'SUPPORT',
  MERCHANT = 'MERCHANT',
}

export enum ShopStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

export enum ComplaintStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

/** Admin panel में जो भूमिकाएँ चलती हैं (MERCHANT कभी नहीं). */
export const ADMIN_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPPORT,
];

export function isAdminRole(role: string | undefined | null): boolean {
  return (ADMIN_ROLES as string[]).includes(String(role));
}

/** दुकान review (approve/reject/suspend): SUPER_ADMIN + ADMIN ही. */
export function canReviewShops(role: string): boolean {
  return role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;
}

/** शिकायतों का जीवन-चक्र: तीनों admin भूमिकाएँ. */
export function canHandleComplaints(role: string): boolean {
  return isAdminRole(role);
}

/** एडमिन अकाउंट मैनेज करना: सिर्फ़ SUPER_ADMIN. */
export function canManageAdmins(role: string): boolean {
  return role === UserRole.SUPER_ADMIN;
}

/** पॉलिसी बदलना: SUPER_ADMIN + ADMIN (SUPPORT पढ़ सकता है). */
export function canEditPolicies(role: string): boolean {
  return role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;
}

/** ऑडिट लॉग पढ़ना: SUPER_ADMIN + ADMIN. */
export function canViewAudit(role: string): boolean {
  return role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN;
}

/* ------------------------- shop status transitions ------------------------ */
/**
 * दुकान status सिर्फ़ admin action से बदलता है (merchant submit_for_approval
 * नियम shops.service.ts में है — DRAFT/REJECTED → PENDING).
 *
 *   APPROVE    : DRAFT|PENDING|REJECTED|SUSPENDED → APPROVED (+auto-publish)
 *   REJECT     : DRAFT|PENDING → REJECTED (कारण ज़रूरी)
 *   SUSPEND    : PENDING|APPROVED → SUSPENDED (public से हटती है)
 *   UNSUSPEND  : SUSPENDED → APPROVED (वापस public)
 * REJECTED दुकान खुद दोबारा submit करके PENDING बनती है (merchant रास्ता);
 * APPROVED को REJECT करना मान्य नहीं — SUSPEND का रास्ता है.
 */
export type ShopAction = 'APPROVE' | 'REJECT' | 'SUSPEND' | 'UNSUSPEND';

export interface ShopActionRule {
  next: ShopStatus;
  from: ShopStatus[];
  /** reject/suspend पर कारण ज़रूरी. */
  needsReason?: boolean;
  /** approve/unsuspend पर published=TRUE, बाकी पर FALSE. */
  publish: boolean;
}

export const SHOP_ACTIONS: Record<ShopAction, ShopActionRule> = {
  APPROVE: {
    next: ShopStatus.APPROVED,
    from: [ShopStatus.DRAFT, ShopStatus.PENDING, ShopStatus.REJECTED, ShopStatus.SUSPENDED],
    publish: true,
  },
  REJECT: {
    next: ShopStatus.REJECTED,
    from: [ShopStatus.DRAFT, ShopStatus.PENDING],
    needsReason: true,
    publish: false,
  },
  SUSPEND: {
    next: ShopStatus.SUSPENDED,
    from: [ShopStatus.PENDING, ShopStatus.APPROVED],
    needsReason: true,
    publish: false,
  },
  UNSUSPEND: {
    next: ShopStatus.APPROVED,
    from: [ShopStatus.SUSPENDED],
    publish: true,
  },
};

export type ShopTransitionResult =
  | { ok: true; next: ShopStatus; publish: boolean; needsReason: boolean }
  | { ok: false; code: string; message: string };

export function shopTransition(current: string, action: string): ShopTransitionResult {
  const rule = (SHOP_ACTIONS as Record<string, ShopActionRule>)[String(action)];
  if (!rule) {
    return { ok: false, code: 'UNKNOWN_ACTION', message: 'नहीं पहचाना गया काम (APPROVE/REJECT/SUSPEND/UNSUSPEND)' };
  }
  const known = Object.values(ShopStatus) as string[];
  if (!known.includes(String(current))) {
    // पुरानी वैल्यू (PENDING_APPROVAL/PUBLISHED) migration 008 normalize करती
    // है; फिर भी अज्ञात मिले तो साफ़ 409 — DB corrupt होने पर भी क्रैश नहीं.
    return { ok: false, code: 'UNKNOWN_STATUS', message: 'दुकान की स्थिति अज्ञात है — migration 008 चली?' };
  }
  if (rule.from.indexOf(current as ShopStatus) === -1) {
    const msg: Record<string, string> = {
      [ShopStatus.APPROVED]: 'दुकान पहले से अप्रूव्ड है (सस्पेंड करना हो तो SUSPEND)',
      [ShopStatus.REJECTED]: 'रिजेक्ट दुकान फिर से reject नहीं हो सकती',
      [ShopStatus.SUSPENDED]: 'दुकान पहले से सस्पेंड है (वापस लाना हो तो UNSUSPEND)',
      [ShopStatus.DRAFT]: 'ड्राफ़्ट दुकान का यह कदम मान्य नहीं',
      [ShopStatus.PENDING]: 'लंबित दुकान पर यह कदम मान्य नहीं',
    };
    return { ok: false, code: 'BAD_TRANSITION', message: msg[String(current)] || 'इस स्थिति से यह कदम मान्य नहीं' };
  }
  return { ok: true, next: rule.next, publish: rule.publish, needsReason: !!rule.needsReason };
}

/** Admin list-queue जिन statuses को दिखाता है (नई भेजी + ड्राफ़्ट). */
export function isQueueStatus(status: string): boolean {
  return status === ShopStatus.PENDING || status === ShopStatus.DRAFT;
}

/* ---------------------- complaint status transitions --------------------- */
/**
 * शिकायत जीवन-चक्र (सख्त क्रम):
 *   OPEN → IN_PROGRESS → RESOLVED → CLOSED
 *   RESOLVED → IN_PROGRESS (REOPEN — ग्राहक/एडमिन असंतुष्ट; पर खुला फिर से)
 *   CLOSED terminal है — बंद शिकायत कुछ नहीं बदल सकता (नई शिकायत बनाएं).
 * START पर ज़िम्मेदारी (assigned_to) + first_response_at लगता है.
 */
export type ComplaintAction = 'START' | 'RESOLVE' | 'CLOSE' | 'REOPEN';

export interface ComplaintActionRule {
  next: ComplaintStatus;
  from: ComplaintStatus[];
  /** RESOLVE को हल-नोट ज़रूरी; बाकी optional. */
  needsNote?: boolean;
  /** START पर assigned_to लगता है. */
  assigns?: boolean;
}

export const COMPLAINT_ACTIONS: Record<ComplaintAction, ComplaintActionRule> = {
  START:   { next: ComplaintStatus.IN_PROGRESS, from: [ComplaintStatus.OPEN],      assigns: true },
  RESOLVE: { next: ComplaintStatus.RESOLVED,    from: [ComplaintStatus.IN_PROGRESS], needsNote: true },
  CLOSE:   { next: ComplaintStatus.CLOSED,      from: [ComplaintStatus.RESOLVED] },
  REOPEN:  { next: ComplaintStatus.IN_PROGRESS, from: [ComplaintStatus.RESOLVED] },
};

export type ComplaintTransitionResult =
  | { ok: true; next: ComplaintStatus; needsNote: boolean; assigns: boolean }
  | { ok: false; code: string; message: string };

export function complaintTransition(current: string, action: string): ComplaintTransitionResult {
  const rule = (COMPLAINT_ACTIONS as Record<string, ComplaintActionRule>)[String(action)];
  if (!rule) {
    return { ok: false, code: 'UNKNOWN_ACTION', message: 'नहीं पहचाना गया काम (START/RESOLVE/CLOSE/REOPEN)' };
  }
  const known = Object.values(ComplaintStatus) as string[];
  if (!known.includes(String(current))) {
    return { ok: false, code: 'UNKNOWN_STATUS', message: 'शिकायत की स्थिति अज्ञात है' };
  }
  if (rule.from.indexOf(current as ComplaintStatus) === -1) {
    const msg: Record<string, string> = {
      [ComplaintStatus.OPEN]: 'शिकायत अभी खुली है — पहले START से अपने नाम लें',
      [ComplaintStatus.IN_PROGRESS]: 'शिकायत पहले से चल रही है (RESOLVE करें)',
      [ComplaintStatus.RESOLVED]: 'हल हो चुकी शिकायत (CLOSE करें या REOPEN)',
      [ComplaintStatus.CLOSED]: 'शिकायत बंद हो चुकी है — अब कुछ नहीं बदलेगा',
    };
    return {
      ok: false,
      code: 'BAD_TRANSITION',
      message: msg[String(current)] || 'इस स्थिति से यह कदम मान्य नहीं',
    };
  }
  return { ok: true, next: rule.next, needsNote: !!rule.needsNote, assigns: !!rule.assigns };
}

/** शिकायत कैटेगरी (form चुनता है; DB CHECK भी यही list). */
export const COMPLAINT_CATEGORIES = [
  'ORDER', 'SHOP', 'PRODUCT', 'DELIVERY', 'PAYMENT', 'OTHER',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

/** किसने शिकायत दर्ज की. */
export const COMPLAINT_SOURCES = ['CUSTOMER', 'MERCHANT'] as const;
export type ComplaintSource = (typeof COMPLAINT_SOURCES)[number];

/** शिकायत की प्राथमिकता. */
export const COMPLAINT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];
