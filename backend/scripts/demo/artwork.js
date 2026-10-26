import sharp from 'sharp';

/**
 * Generated artwork for the demo catalogue: product tiles and promo banners
 * drawn as SVG and rendered to PNG, so the seed needs no downloaded images.
 */

// Icon outlines on a 24-unit grid (after Lucide, ISC licence), stroked in white.
const ICONS = {
    basket: ['m15 11-1 9', 'm19 11-4-7', 'M2 11h20', 'm3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4', 'M4.5 15.5h15', 'm5 11 4-7', 'm9 11 1 9'],
    leaf: ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z', 'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12'],
    bolt: ['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'],
    shirt: ['M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z']
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Greedy word wrap to at most `lines` lines of about `width` characters. */
const wrap = (text, width, lines) => {
    const out = [];
    let line = '';
    for (const word of String(text).split(/\s+/)) {
        if (line && (line + ' ' + word).length > width) {
            out.push(line);
            line = word;
        } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
    if (out.length > lines) {
        out.length = lines;
        out[lines - 1] = `${out[lines - 1].replace(/\s+\S*$/, '')}…`;
    }
    return out;
};

const icon = (name, x, y, size, opacity = 1) =>
    `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="#fff" stroke-opacity="${opacity}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]
        .map((d) => `<path d="${d}"/>`)
        .join('')}</g>`;

const gradient = (id, [from, to]) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;

const FONT = `font-family="DejaVu Sans, Poppins, Arial, sans-serif"`;

const render = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

/** Square product tile: tinted background, big icon, name and a variant chip. */
export const productTile = ({ name, caption, colors, iconName }) => {
    const lines = wrap(name, 18, 3);
    const nameY = 560 - (lines.length - 1) * 30;
    return render(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800">
  <defs>${gradient('g', colors)}</defs>
  <rect width="800" height="800" fill="url(#g)"/>
  <circle cx="680" cy="120" r="220" fill="#fff" fill-opacity=".08"/>
  <circle cx="90" cy="760" r="260" fill="#fff" fill-opacity=".07"/>
  <circle cx="400" cy="270" r="170" fill="#fff" fill-opacity=".14"/>
  ${icon(iconName, 290, 160, 220)}
  ${lines.map((l, i) => `<text x="400" y="${nameY + i * 64}" text-anchor="middle" ${FONT} font-size="54" font-weight="700" fill="#fff">${esc(l)}</text>`).join('')}
  ${caption ? `<rect x="${400 - (caption.length * 13 + 48) / 2}" y="${nameY + lines.length * 64 - 10}" width="${caption.length * 13 + 48}" height="54" rx="27" fill="#fff" fill-opacity=".2"/>
  <text x="400" y="${nameY + lines.length * 64 + 26}" text-anchor="middle" ${FONT} font-size="26" font-weight="600" fill="#fff">${esc(caption)}</text>` : ''}
</svg>`);
};

/** Wide promo banner (3:1): headline, subtitle, call to action, icon on the right. */
export const bannerArt = ({ title, subtitle, cta, colors, iconName }) => {
    const lines = wrap(title, 22, 2);
    const titleY = lines.length > 1 ? 150 : 185;
    const ctaWidth = cta.length * 17 + 64;
    return render(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
  <defs>${gradient('g', colors)}</defs>
  <rect width="1200" height="400" fill="url(#g)"/>
  <circle cx="1010" cy="200" r="260" fill="#fff" fill-opacity=".09"/>
  <circle cx="1010" cy="200" r="170" fill="#fff" fill-opacity=".12"/>
  <circle cx="80" cy="-40" r="160" fill="#fff" fill-opacity=".07"/>
  ${icon(iconName, 900, 90, 220)}
  ${lines.map((l, i) => `<text x="72" y="${titleY + i * 66}" ${FONT} font-size="58" font-weight="700" fill="#fff">${esc(l)}</text>`).join('')}
  <text x="72" y="${titleY + lines.length * 66 - 6}" ${FONT} font-size="28" fill="#fff" fill-opacity=".9">${esc(subtitle)}</text>
  <rect x="72" y="${titleY + lines.length * 66 + 30}" width="${ctaWidth}" height="58" rx="29" fill="#fff"/>
  <text x="${72 + ctaWidth / 2}" y="${titleY + lines.length * 66 + 68}" text-anchor="middle" ${FONT} font-size="26" font-weight="700" fill="${colors[1]}">${esc(cta)} →</text>
</svg>`);
};

/** Category tile: soft square with the icon, for category grids. */
export const categoryTile = ({ name, colors, iconName }) =>
    render(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>${gradient('g', colors)}</defs>
  <rect width="400" height="400" rx="48" fill="url(#g)"/>
  <circle cx="330" cy="70" r="120" fill="#fff" fill-opacity=".1"/>
  ${icon(iconName, 125, 70, 150)}
  ${wrap(name, 16, 2).map((l, i, all) => `<text x="200" y="${(all.length > 1 ? 290 : 310) + i * 44}" text-anchor="middle" ${FONT} font-size="38" font-weight="700" fill="#fff">${esc(l)}</text>`).join('')}
</svg>`);

/**
 * A photo banner: the image cropped to 3:1, darkened on the left so text
 * reads, with the headline, subtitle and call to action drawn on top.
 * (Generated images often garble lettering, so text is never left to them.)
 */
export const bannerOverlay = async ({ photo, title, subtitle, cta, accent = '#16a34a' }) => {
    const base = await sharp(photo).resize(1200, 400, { fit: 'cover', position: 'attention' }).toBuffer();
    const lines = wrap(title, 22, 2);
    const titleY = lines.length > 1 ? 150 : 185;
    const ctaWidth = cta.length * 17 + 64;
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
  <defs><linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity=".72"/><stop offset=".55" stop-color="#000" stop-opacity=".35"/><stop offset=".8" stop-color="#000" stop-opacity="0"/>
  </linearGradient></defs>
  <rect width="1200" height="400" fill="url(#shade)"/>
  ${lines.map((l, i) => `<text x="72" y="${titleY + i * 66}" ${FONT} font-size="58" font-weight="700" fill="#fff">${esc(l)}</text>`).join('')}
  <text x="72" y="${titleY + lines.length * 66 - 6}" ${FONT} font-size="28" fill="#fff" fill-opacity=".92">${esc(subtitle)}</text>
  <rect x="72" y="${titleY + lines.length * 66 + 30}" width="${ctaWidth}" height="58" rx="29" fill="#fff"/>
  <text x="${72 + ctaWidth / 2}" y="${titleY + lines.length * 66 + 68}" text-anchor="middle" ${FONT} font-size="26" font-weight="700" fill="${accent}">${esc(cta)} →</text>
</svg>`;
    return sharp(base).composite([{ input: Buffer.from(overlay) }]).png().toBuffer();
};
