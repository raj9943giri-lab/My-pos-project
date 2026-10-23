import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Injectable()
export class ShopCategoriesService {
  constructor(private db: DbService) {}

  async listActive() {
    const rows = await this.db.query(
      `SELECT id, name, name_en AS "nameEn", emoji, license_required AS "licenseRequired",
              license_label AS "licenseLabel", sort_order AS "sortOrder"
       FROM shop_categories WHERE is_active ORDER BY sort_order`);
    return { items: rows };
  }
}
