import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ShopsModule } from './shops/shops.module';
import { ShopCategoriesModule } from './shop-categories/shop-categories.module';
import { AdminModule } from './admin/admin.module';
import { ProductsModule } from './products/products.module';
import { ProductCategoriesModule } from './product-categories/product-categories.module';
import { InventoryModule } from './inventory/inventory.module';
import { BulkOperationsModule } from './bulk-operations/bulk-operations.module';
import { PublicStoreModule } from './public-store/public-store.module';
import { OrdersModule } from './orders/orders.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ComplaintsModule } from './complaints/complaints.module';

@Module({
  imports: [
    AuthModule,
    ShopsModule,
    ShopCategoriesModule,
    AdminModule,
    // PART 3 — product catalogue, inventory, bulk operations
    ProductsModule,
    ProductCategoriesModule,
    InventoryModule,
    BulkOperationsModule,
    // PART 4 — customer storefront (public shop, search, cart, checkout)
    PublicStoreModule,
    // PART 5 — order lifecycle, fulfilment, notifications
    OrdersModule,
    NotificationsModule,
    // PART 7 — complaints (customer/merchant filing + admin lifecycle)
    ComplaintsModule,
  ],
})
export class AppModule {}
