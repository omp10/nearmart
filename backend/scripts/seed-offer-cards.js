import { connectDB, disconnectDB } from '../src/config/db.js';
import { OfferCard } from '../src/modules/offers/offerCard.model.js';
import { Category } from '../src/modules/catalog/category.model.js';
import { OFFER_CARDS } from './demo/catalog.js';
import { publicUrl } from '../src/modules/uploads/storage.service.js';

/** The app needs full URLs; seed data names files under the uploads root ("/uploads/offers/x.webp"). */
const imageUrl = (image) => (image.startsWith('/uploads/') ? publicUrl(image.slice('/uploads/'.length)) : image);

async function main() {
    await connectDB();
    console.log('Connected to MongoDB. Seeding offer cards...');

    for (const c of OFFER_CARDS) {
        let linkType = c.link?.type || 'none';
        let linkValue = c.link?.value || '';

        if (linkType === 'category') {
            const cat = await Category.findOne({ name: c.link.value, module: c.module });
            if (cat) {
                linkValue = String(cat._id);
            } else {
                linkType = 'search';
            }
        }

        const existing = await OfferCard.findOne({ module: c.module, title: c.title });
        if (existing) {
            existing.label = c.label || 'UP TO';
            existing.discountText = c.discountText;
            existing.image = imageUrl(c.image);
            existing.backgroundColor = c.backgroundColor;
            existing.link = { type: linkType, value: linkValue };
            existing.sortOrder = c.sortOrder ?? 0;
            existing.isActive = true;
            await existing.save();
            console.log(`Updated offer card: ${c.title} (${c.module})`);
        } else {
            await OfferCard.create({
                module: c.module,
                title: c.title,
                label: c.label || 'UP TO',
                discountText: c.discountText,
                image: imageUrl(c.image),
                backgroundColor: c.backgroundColor,
                link: { type: linkType, value: linkValue },
                sortOrder: c.sortOrder ?? 0,
                isActive: true
            });
            console.log(`Created offer card: ${c.title} (${c.module})`);
        }
    }

    console.log('Done!');
}

main()
    .catch(console.error)
    .finally(() => disconnectDB());
