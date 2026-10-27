import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SOURCE_DIR = 'C:/Users/ompar/.gemini/antigravity-ide/brain/1e7a024c-0901-4c99-b9ab-a68b2df554de';
const TARGET_DIR = path.resolve('uploads/offers');

const IMAGES = [
    { src: 'offer_beverages_1793103605852.jpg', dest: 'beverages.webp' },
    { src: 'offer_oils_ghee_notext_1793103651312.jpg', dest: 'oils-ghee.webp' },
    { src: 'offer_staples_1793103669138.jpg', dest: 'staples.webp' },
    { src: 'offer_dairy_1793103690690.jpg', dest: 'dairy.webp' },
    { src: 'offer_snacks_1793103710965.jpg', dest: 'snacks.webp' },
    { src: 'offer_fresh_fruits_1793103730124.jpg', dest: 'fresh-fruits.webp' }
];

async function main() {
    await fs.mkdir(TARGET_DIR, { recursive: true });
    for (const item of IMAGES) {
        const inputPath = path.join(SOURCE_DIR, item.src);
        const outputPath = path.join(TARGET_DIR, item.dest);

        // Resize to 800x1000 (4:5), fit cover, center/bottom position
        const buffer = await sharp(inputPath)
            .resize(800, 1000, { fit: 'cover', position: 'center' })
            .webp({ quality: 85, effort: 4 })
            .toBuffer();

        await fs.writeFile(outputPath, buffer);
        const stats = await fs.stat(outputPath);
        console.log(`Processed ${item.dest}: ${stats.size} bytes (${(stats.size / 1024).toFixed(1)} KB)`);

        if (stats.size > 150 * 1024) {
            console.error(`WARNING: ${item.dest} exceeds 150 KB limit!`);
        }
    }
}

main().catch(console.error);
