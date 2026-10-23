import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { slugCandidates, slugify, SLUG_RE } from '../common/slug';

@Injectable()
export class SlugService {
  constructor(private db: DbService) {}

  /** GET /shops/check-slug?slug=rajesh-kirana */
  async check(rawSlug: string, opts: { excludeShopId?: string } = {}) {
    let slug = slugify(String(rawSlug || ''));
    const valid = SLUG_RE.test(slug);
    let taken = false;
    if (valid) {
      const row = await this.db.one<{ id: string }>(
        'SELECT id FROM shops WHERE slug = $1 LIMIT 1', [slug]);
      taken = !!row && (!opts.excludeShopId || row.id !== opts.excludeShopId);
    }
    const suggestions = (taken || !valid) ? slugCandidates(slug) : [];
    return { slug, available: valid && !taken, suggestions };
  }
}
