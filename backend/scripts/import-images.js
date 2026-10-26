/**
 * Replaces catalogue images with ones you provide (photos, AI-generated art),
 * matched by file name:
 *
 *   <dir>/products/<product-slug>.(png|jpg|jpeg|webp)
 *   <dir>/categories/<category-slug>.(…)
 *   <dir>/services/<laundry-service-slug>.(…)
 *   <dir>/banners/<banner-title-slug>.(…)     e.g. "Groceries in 30 minutes" → groceries-in-30-minutes
 *
 *   npm run images:import -- --list            print every expected file name
 *   npm run images:import -- <dir> --dry-run   show what would change
 *   npm run images:import -- <dir>             import
 *   npm run images:import -- <dir> --raw-banners   use banner images as they are (no text overlay)
 *
 * Images go through the normal upload pipeline (re-encoded to WebP, served
 * under UPLOAD_BASE_URL). Banners get the headline, subtitle and button drawn
 * on top unless --raw-banners is given, so the artwork needs no text.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Banner } from '../src/modules/banners/banner.model.js';
import { Category } from '../src/modules/catalog/category.model.js';
import { Product } from '../src/modules/catalog/product.model.js';
import { LaundryService } from '../src/modules/laundry/laundryService.model.js';
import { saveImage } from '../src/modules/uploads/storage.service.js';
import { bannerOverlay } from './demo/artwork.js';
import { BANNERS } from './demo/catalog.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const dir = args.find((a) => !a.startsWith('--'));
const EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export const slugify = (s) =>
    String(s)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

const bannerText = (title) => BANNERS.find((b) => b.title === title);

/** Every record that can take an image, with the file it expects. */
const targets = async () => {
    const [products, categories, services, banners] = await Promise.all([
        Product.find().select('name slug module brand variants.label').sort({ module: 1, name: 1 }).lean(),
        Category.find().select('name slug module parent').sort({ module: 1, name: 1 }).lean(),
        LaundryService.find().select('name slug').sort({ sortOrder: 1 }).lean(),
        Banner.find().select('title placement').sort({ placement: 1, sortOrder: 1 }).lean()
    ]);
    return [
        ...products.map((p) => ({ kind: 'products', key: p.slug, label: `${p.module} · ${p.name} (${p.variants[0]?.label ?? ''})`, doc: p, model: Product })),
        ...categories.map((c) => ({ kind: 'categories', key: c.slug, label: `${c.module} · ${c.name}${c.parent ? ' (subcategory)' : ''}`, doc: c, model: Category })),
        ...services.map((s) => ({ kind: 'services', key: s.slug, label: `laundry · ${s.name}`, doc: s, model: LaundryService })),
        ...banners.map((b) => ({ kind: 'banners', key: slugify(b.title), label: `${b.placement} · ${b.title}`, doc: b, model: Banner }))
    ];
};

const findFile = async (kind, key) => {
    for (const ext of EXTS) {
        const file = path.join(dir, kind, key + ext);
        try {
            await fs.access(file);
            return file;
        } catch {
            /* try the next extension */
        }
    }
    return null;
};

await connectDB();
try {
    const all = await targets();
    if (flags.has('--list')) {
        for (const t of all) console.log(`${t.kind}/${t.key}.png\t${t.label}`);
        console.log(`\n${all.length} images expected.`);
    } else if (!dir) {
        console.error('Usage: npm run images:import -- <dir> [--dry-run] [--raw-banners]   (or --list)');
        process.exitCode = 1;
    } else {
        let done = 0;
        const missing = [];
        for (const t of all) {
            const file = await findFile(t.kind, t.key);
            if (!file) {
                missing.push(`${t.kind}/${t.key}`);
                continue;
            }
            if (flags.has('--dry-run')) {
                console.log(`would update ${t.label}  ←  ${path.relative(dir, file)}`);
                done++;
                continue;
            }
            let buffer = await fs.readFile(file);
            let mimetype = MIME[path.extname(file).toLowerCase()];
            const text = t.kind === 'banners' ? bannerText(t.doc.title) : null;
            if (text && !flags.has('--raw-banners')) {
                buffer = await bannerOverlay({ photo: buffer, title: text.title, subtitle: text.subtitle, cta: text.cta, accent: text.colors[1] });
                mimetype = 'image/png';
            }
            const folder = { products: 'catalog', categories: 'categories', services: 'services', banners: 'banners' }[t.kind];
            const { url } = await saveImage({ buffer, mimetype }, folder);
            const update = t.kind === 'products' ? { images: [url] } : { image: url };
            await t.model.updateOne({ _id: t.doc._id }, { $set: update });
            console.log(`updated ${t.label}`);
            done++;
        }
        console.log(`\n${flags.has('--dry-run') ? 'Would update' : 'Updated'} ${done} of ${all.length}.`);
        if (missing.length) {
            const shown = missing.slice(0, 10).join(', ');
            console.log(`No image for ${missing.length}: ${shown}${missing.length > 10 ? `, … (${missing.length - 10} more; --list shows all)` : ''}`);
        }
    }
} finally {
    await disconnectDB();
}
