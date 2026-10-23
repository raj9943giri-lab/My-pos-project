/* PART 7 — roles & status enums (pure): permission matrix, shop transitions,
 * complaint transitions. DB-free — हर environment में चलता है. */
import {
  UserRole, ShopStatus, ComplaintStatus, ADMIN_ROLES, isAdminRole,
  canReviewShops, canHandleComplaints, canManageAdmins, canEditPolicies, canViewAudit,
  shopTransition, complaintTransition,
} from '../../src/common/roles';

/** नाक-साफ़ नाक-साफ़ narrow helpers — { ok:false } पर रुकती हैं (union-type जाल से). */
function shopBad(r: { ok: boolean; code?: string }): { code?: string } {
  expect(r.ok).toBe(false);
  return r as { code?: string };
}
function complaintBad(r: { ok: boolean; code?: string }): { code?: string } {
  expect(r.ok).toBe(false);
  return r as { code?: string };
}

describe('PART 7 permission matrix', () => {
  it('admin roles = SUPER_ADMIN + ADMIN + SUPPORT (MERCHANT बाहर)', () => {
    expect(ADMIN_ROLES).toEqual([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT]);
    expect(isAdminRole('SUPPORT')).toBe(true);
    expect(isAdminRole('MERCHANT')).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });

  it('shop review सिर्फ़ SUPER/ADMIN — SUPPORT नहीं, MERCHANT कभी नहीं', () => {
    expect(canReviewShops(UserRole.SUPER_ADMIN)).toBe(true);
    expect(canReviewShops(UserRole.ADMIN)).toBe(true);
    expect(canReviewShops(UserRole.SUPPORT)).toBe(false);
    expect(canReviewShops(UserRole.MERCHANT)).toBe(false);
  });

  it('complaints तीनों admin भूमिकाएँ चला सकती हैं', () => {
    expect(canHandleComplaints(UserRole.SUPER_ADMIN)).toBe(true);
    expect(canHandleComplaints(UserRole.ADMIN)).toBe(true);
    expect(canHandleComplaints(UserRole.SUPPORT)).toBe(true);
    expect(canHandleComplaints(UserRole.MERCHANT)).toBe(false);
  });

  it('admins manage सिर्फ़ SUPER_ADMIN; पॉलिसी/ऑडिट SUPER+ADMIN', () => {
    expect(canManageAdmins(UserRole.SUPER_ADMIN)).toBe(true);
    expect(canManageAdmins(UserRole.ADMIN)).toBe(false);
    expect(canEditPolicies(UserRole.ADMIN)).toBe(true);
    expect(canEditPolicies(UserRole.SUPPORT)).toBe(false);
    expect(canViewAudit(UserRole.ADMIN)).toBe(true);
    expect(canViewAudit(UserRole.SUPPORT)).toBe(false);
  });

  it('enum values spec के ठीक मुताबिक', () => {
    expect(UserRole.MERCHANT).toBe('MERCHANT');
    expect(ShopStatus.PENDING).toBe('PENDING');
    expect(Object.values(ShopStatus)).toEqual(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
    expect(Object.values(ComplaintStatus)).toEqual(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
  });
});

describe('PART 7 shop transitions', () => {
  it('APPROVE: PENDING/REJECTED/SUSPENDED/DRAFT → APPROVED + auto-publish', () => {
    for (const from of ['PENDING', 'REJECTED', 'SUSPENDED', 'DRAFT']) {
      const r = shopTransition(from, 'APPROVE');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.next).toBe(ShopStatus.APPROVED);
        expect(r.publish).toBe(true);
        expect(r.needsReason).toBe(false);
      }
    }
  });

  it('REJECT: पेंडिंग/ड्राफ़्ट से ही; कारण ज़रूरी; APPROVED से नहीं', () => {
    const r = shopTransition('PENDING', 'REJECT');
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.next).toBe(ShopStatus.REJECTED); expect(r.needsReason).toBe(true); }
    expect(shopTransition('APPROVED', 'REJECT').ok).toBe(false);
    expect(shopTransition('SUSPENDED', 'REJECT').ok).toBe(false);
  });

  it('SUSPEND: APPROVED/PENDING से; UNSUSPEND सिर्फ़ SUSPENDED से', () => {
    expect(shopTransition('APPROVED', 'SUSPEND')).toMatchObject({ ok: true, next: ShopStatus.SUSPENDED });
    expect(shopTransition('PENDING', 'SUSPEND')).toMatchObject({ ok: true, next: ShopStatus.SUSPENDED });
    expect(shopTransition('DRAFT', 'SUSPEND').ok).toBe(false);
    const u = shopTransition('SUSPENDED', 'UNSUSPEND');
    expect(u).toMatchObject({ ok: true, next: ShopStatus.APPROVED, publish: true });
    expect(shopTransition('APPROVED', 'UNSUSPEND').ok).toBe(false);
  });

  it('REJECTED दुकान merchant submit से फिर PENDING — admin यहाँ APPROVE कर सकता है', () => {
    expect(shopTransition('REJECTED', 'APPROVE').ok).toBe(true);
  });

  it('अज्ञात action/status पर साफ़ 409-नियम', () => {
    expect(shopBad(shopTransition('PENDING', 'DELETE' as string)).code).toBe('UNKNOWN_ACTION');
    expect(shopBad(shopTransition('PENDING_APPROVAL', 'APPROVE')).code).toBe('UNKNOWN_STATUS');
  });
});

describe('PART 7 complaint transitions', () => {
  it('खुला → प्रगति में → हल → बंद', () => {
    const s = complaintTransition('OPEN', 'START');
    expect(s).toMatchObject({ ok: true, next: ComplaintStatus.IN_PROGRESS, assigns: true });
    const rv = complaintTransition('IN_PROGRESS', 'RESOLVE');
    expect(rv).toMatchObject({ ok: true, next: ComplaintStatus.RESOLVED, needsNote: true });
    expect(complaintTransition('RESOLVED', 'CLOSE')).toMatchObject({ ok: true, next: ComplaintStatus.CLOSED });
  });

  it('RESOLVED → REOPEN वापस IN_PROGRESS; CLOSED terminal', () => {
    expect(complaintTransition('RESOLVED', 'REOPEN')).toMatchObject({ ok: true, next: ComplaintStatus.IN_PROGRESS });
    for (const a of ['START', 'RESOLVE', 'CLOSE', 'REOPEN']) {
      expect(complaintTransition('CLOSED', a).ok).toBe(false);
    }
  });

  it('क्रम तोड़ना मना (OPEN पर RESOLVE, IN_PROGRESS पर START…)', () => {
    const bad = [complaintTransition('OPEN', 'RESOLVE'), complaintTransition('IN_PROGRESS', 'START'),
      complaintTransition('OPEN', 'CLOSE'), complaintTransition('OPEN', 'REOPEN')];
    for (const c of bad) {
      expect(c.ok).toBe(false);
    }
  });

  it('अज्ञात action/status पर साफ़ नियम', () => {
    expect(complaintBad(complaintTransition('OPEN', 'DELETE' as string)).code).toBe('UNKNOWN_ACTION');
    expect(complaintBad(complaintTransition('WEIRD', 'START')).code).toBe('UNKNOWN_STATUS');
  });
});
