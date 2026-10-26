/**
 * Loads a demo catalogue so the customer app and the panel have something to
 * show: categories and products in Grocery, Produce and Electronics, the
 * laundry price chart, banners for the home screen and every module, a
 * service area, delivery/pickup slots and a few coupons. Images are generated.
 *
 *   npm run seed:demo             add it (refuses if a module already has products)
 *   npm run seed:demo -- --force  add it anyway
 *   npm run seed:demo -- --remove take out everything a previous run added
 *
 * Every id it creates is recorded in the `demo_seed` collection, which is how
 * --remove knows what to delete and leaves your own data alone.
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Banner } from '../src/modules/banners/banner.model.js';
import { Category } from '../src/modules/catalog/category.model.js';
import { createCategory } from '../src/modules/catalog/category.service.js';
import { Product } from '../src/modules/catalog/product.model.js';
import { createProduct } from '../src/modules/catalog/product.service.js';
import { StockMovement } from '../src/modules/catalog/stockMovement.model.js';
import { Coupon } from '../src/modules/coupons/coupon.model.js';
import { createCoupon } from '../src/modules/coupons/coupon.service.js';
import { LaundryService } from '../src/modules/laundry/laundryService.model.js';
import { createService } from '../src/modules/laundry/booking.service.js';
import { SlotRule } from '../src/modules/slots/slot.model.js';
import { createRule } from '../src/modules/slots/slot.service.js';
import { saveImage } from '../src/modules/uploads/storage.service.js';
import { Zone } from '../src/modules/zones/zone.model.js';
import { createZone } from '../src/modules/zones/zone.service.js';
import { bannerArt, categoryTile, productTile } from './demo/artwork.js';
import { BANNERS, CATALOG, COUPONS, LAUNDRY_SERVICES, MODULE_THEME, SLOT_RULES } from './demo/catalog.js';

const args = new Set(process.argv.slice(2));
const paise = (rupees) => (rupees == null ? null : Math.round(rupees * 100));
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const actor = { kind: 'system', id: null };

const store = async (buffer, folder) => (await saveImage({ buffer, mimetype: 'image/png' }, folder)).url;

await connectDB();
const log = mongoose.connection.collection('demo_seed');

try {
    if (args.has('--remove')) {
        const runs = await log.find().toArray();
        const ids = (key) => runs.flatMap((r) => r.ids[key] ?? []);
        const products = ids('products');
        await StockMovement.deleteMany({ product: { $in: products } });
        const removed = {
            products: (await Product.deleteMany({ _id: { $in: products } })).deletedCount,
            categories: (await Category.deleteMany({ _id: { $in: ids('categories') } })).deletedCount,
            laundryServices: (await LaundryService.deleteMany({ _id: { $in: ids('laundryServices') } })).deletedCount,
            banners: (await Banner.deleteMany({ _id: { $in: ids('banners') } })).deletedCount,
            coupons: (await Coupon.deleteMany({ _id: { $in: ids('coupons') } })).deletedCount,
            slotRules: (await SlotRule.deleteMany({ _id: { $in: ids('slotRules') } })).deletedCount,
            zones: (await Zone.deleteMany({ _id: { $in: ids('zones') } })).deletedCount
        };
        await log.deleteMany({});
        console.log('Demo data removed:', removed);
    } else {
        const existing = await Product.countDocuments();
        if (existing && !args.has('--force')) {
            console.error(`There are already ${existing} products. Pass --force to add the demo catalogue anyway.`);
            process.exitCode = 1;
        } else {
            const ids = { products: [], categories: [], laundryServices: [], banners: [], coupons: [], slotRules: [], zones: [] };
            const byName = { category: new Map(), product: new Map() };

            // Catalogue: categories (with tiles), subcategories, products (with tiles).
            for (const [module, categories] of Object.entries(CATALOG)) {
                const { icon } = MODULE_THEME[module];
                let order = 0;
                const addProducts = async (category, colors, products) => {
                    for (const p of products) {
                        const first = p.variants[0];
                        const image = await store(await productTile({ name: p.name, caption: first.label, colors, iconName: icon }), 'catalog');
                        const product = await createProduct(
                            {
                                module,
                                category: category._id,
                                name: p.name,
                                brand: p.brand ?? '',
                                modelNumber: p.model ?? '',
                                description: p.description ?? `${p.name}${p.brand ? ` by ${p.brand}` : ''}, delivered from your nearest Nearmart store.`,
                                images: [image],
                                specifications: (p.specs ?? []).map(([key, value]) => ({ key, value })),
                                warranty: p.warranty ?? '',
                                handlingNote: p.handlingNote ?? '',
                                availabilityNote: module === 'produce' ? 'Sourced fresh every morning; weight may vary slightly.' : '',
                                gstRate: module === 'electronics' ? 18 : module === 'grocery' ? 5 : 0,
                                isFeatured: Boolean(p.featured),
                                tags: ['demo'],
                                variants: p.variants.map((x) => ({
                                    label: x.label,
                                    unit: x.unit,
                                    unitQty: x.unitQty,
                                    pricePaise: paise(x.price),
                                    offerPricePaise: paise(x.offer),
                                    stockQty: x.stock,
                                    lowStockThreshold: 5
                                }))
                            },
                            { actor, allowedModules: null }
                        );
                        ids.products.push(product._id);
                        byName.product.set(p.name, product._id);
                    }
                };

                for (const c of categories) {
                    const image = await store(await categoryTile({ name: c.name, colors: c.colors, iconName: icon }), 'categories');
                    const category = await createCategory({ module, name: c.name, image, sortOrder: order++ });
                    ids.categories.push(category._id);
                    byName.category.set(c.name, category._id);
                    if (c.products) await addProducts(category, c.colors, c.products);
                    let childOrder = 0;
                    for (const child of c.children ?? []) {
                        const childImage = await store(await categoryTile({ name: child.name, colors: c.colors, iconName: icon }), 'categories');
                        const sub = await createCategory({ module, parent: category._id, name: child.name, image: childImage, sortOrder: childOrder++ });
                        ids.categories.push(sub._id);
                        byName.category.set(child.name, sub._id);
                        await addProducts(sub, c.colors, child.products);
                    }
                }
            }

            // Laundry price chart.
            for (const [i, s] of LAUNDRY_SERVICES.entries()) {
                const image = await store(
                    await productTile({ name: s.name, caption: `₹${s.rate} / ${s.pricingUnit}`, colors: MODULE_THEME.laundry.colors, iconName: 'shirt' }),
                    'services'
                );
                const service = await createService({
                    name: s.name,
                    description: s.description,
                    image,
                    pricingUnit: s.pricingUnit,
                    ratePaise: paise(s.rate),
                    minQty: s.minQty,
                    turnaroundHours: s.turnaroundHours,
                    sortOrder: i
                });
                ids.laundryServices.push(service._id);
            }

            // Banners.
            for (const [i, b] of BANNERS.entries()) {
                const image = await store(await bannerArt({ title: b.title, subtitle: b.subtitle, cta: b.cta, colors: b.colors, iconName: b.icon }), 'banners');
                const value =
                    b.link.type === 'category' ? String(byName.category.get(b.link.value)) : b.link.type === 'product' ? String(byName.product.get(b.link.value)) : b.link.value;
                const banner = await Banner.create({ title: b.title, image, placement: b.placement, link: { type: b.link.type, value }, sortOrder: i });
                ids.banners.push(banner._id);
            }

            // A service area covering India, so the app can order anywhere while testing.
            const zone = await createZone({
                name: 'All India (demo)',
                modules: ['grocery', 'produce', 'laundry', 'electronics'],
                polygon: { type: 'Polygon', coordinates: [[[68, 6.5], [97.5, 6.5], [97.5, 35.7], [68, 35.7], [68, 6.5]]] },
                priority: 100,
                minOrderPaise: paise(99),
                deliveryFeePaise: paise(25),
                freeDeliveryAbovePaise: paise(499)
            });
            ids.zones.push(zone._id);

            for (const rule of SLOT_RULES) ids.slotRules.push((await createRule({ ...rule, daysOfWeek: ALL_DAYS })).id);

            for (const c of COUPONS) {
                const coupon = await createCoupon({
                    code: c.code,
                    description: c.description,
                    type: c.type,
                    value: c.type === 'flat' ? paise(c.value) : c.value,
                    maxDiscountPaise: paise(c.maxDiscount),
                    minOrderPaise: paise(c.minOrder) ?? 0,
                    modules: c.modules,
                    firstOrderOnly: Boolean(c.firstOrderOnly),
                    perUserLimit: 1
                });
                ids.coupons.push(coupon._id);
            }

            await log.insertOne({ createdAt: new Date(), ids });
            console.log('Demo data added:', Object.fromEntries(Object.entries(ids).map(([k, list]) => [k, list.length])));
        }
    }
} finally {
    await disconnectDB();
}
