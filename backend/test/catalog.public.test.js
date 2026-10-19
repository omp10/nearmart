import { beforeEach, describe, expect, it } from 'vitest';
import { api, createStaff, loginStaff } from './helpers.js';

const A = '/api/v1/admin/catalog';
const P = '/api/v1/catalog';
let auth;
let veg;
let fruit;
let tomato;

beforeEach(async () => {
    const { token } = await loginStaff(await createStaff());
    auth = { Authorization: `Bearer ${token}` };
    const post = async (path, body) => {
        const res = await api().post(`${A}${path}`).set(auth).send(body);
        if (res.status !== 201) throw new Error(JSON.stringify(res.body));
        return res.body.data;
    };
    veg = await post('/categories', { module: 'produce', name: 'Vegetables' });
    fruit = await post('/categories', { module: 'produce', name: 'Fruits' });
    tomato = await post('/products', {
        module: 'produce', category: veg._id, name: 'Tomato', tags: ['tamatar'],
        handlingNote: 'Store in a cool place',
        variants: [
            { label: '500 g', unit: 'g', unitQty: 500, pricePaise: 2000, stockQty: 50, maxPerOrder: 5 },
            { label: '1 kg', unit: 'kg', unitQty: 1, pricePaise: 3800, offerPricePaise: 3500, stockQty: 3 },
            { label: 'Hidden', pricePaise: 1, stockQty: 1, isActive: false }
        ]
    });
    await post('/products', {
        module: 'produce', category: veg._id, name: 'Cherry Tomatoes',
        variants: [{ label: '250 g', unit: 'g', unitQty: 250, pricePaise: 6000, stockQty: 0 }]
    });
    await post('/products', {
        module: 'produce', category: fruit._id, name: 'Banana', isFeatured: true,
        variants: [{ label: '1 dozen', unit: 'dozen', pricePaise: 6000, stockQty: 20 }]
    });
});

describe('public catalogue', () => {
    it('lists active modules and an active category tree', async () => {
        await api().patch(`${A}/categories/${fruit._id}`).set(auth).send({ isActive: false });
        const modules = await api().get(`${P}/modules`);
        expect(modules.body.data.map((m) => m.key)).toEqual(['grocery', 'produce', 'laundry', 'electronics']);
        const cats = await api().get(`${P}/categories?module=produce`);
        expect(cats.body.data.map((c) => c.name)).toEqual(['Vegetables']);
    });

    it('hides stock counts and inactive variants, and caps the cart quantity', async () => {
        const res = await api().get(`${P}/products/${tomato.slug}`);
        expect(res.status).toBe(200);
        const p = res.body.data;
        expect(p.variants.map((v) => v.label)).toEqual(['500 g', '1 kg']);
        expect(p.variants[0]).toMatchObject({ inStock: true, maxQty: 5, effectivePricePaise: 2000, offerPricePaise: null });
        expect(p.variants[1]).toMatchObject({ maxQty: 3, effectivePricePaise: 3500, offerPricePaise: 3500 });
        expect(JSON.stringify(p)).not.toContain('stockQty');
        expect(p.handlingNote).toBe('Store in a cool place');
        expect(p.minPricePaise).toBe(2000);
    });

    it('searches by word prefix and tag, and sorts in-stock first', async () => {
        const tom = await api().get(`${P}/products?q=tom`);
        expect(tom.body.data.items.map((p) => p.name)).toEqual(['Tomato', 'Cherry Tomatoes']);
        const tag = await api().get(`${P}/products?q=tamatar`);
        expect(tag.body.data.items.map((p) => p.name)).toEqual(['Tomato']);
        const mid = await api().get(`${P}/products?q=mato`);
        expect(mid.body.data.total).toBe(0);
    });

    it('filters by category, price, stock and featured', async () => {
        const inVeg = await api().get(`${P}/products?category=${veg._id}&inStock=true`);
        expect(inVeg.body.data.items.map((p) => p.name)).toEqual(['Tomato']);
        const cheap = await api().get(`${P}/products?maxPrice=2500&sort=price_asc`);
        expect(cheap.body.data.items.map((p) => p.name)).toEqual(['Tomato']);
        const featured = await api().get(`${P}/products?featured=true`);
        expect(featured.body.data.items.map((p) => p.name)).toEqual(['Banana']);
    });

    it('hides products in inactive categories, inactive products and inactive modules', async () => {
        await api().patch(`${A}/categories/${fruit._id}`).set(auth).send({ isActive: false });
        await api().patch(`${A}/products/${tomato._id}`).set(auth).send({ isActive: false });
        const res = await api().get(`${P}/products?module=produce`);
        expect(res.body.data.items.map((p) => p.name)).toEqual(['Cherry Tomatoes']);
        expect((await api().get(`${P}/products/${tomato._id}`)).status).toBe(404);

        await api().patch(`${A}/modules/produce`).set(auth).send({ isActive: false });
        expect((await api().get(`${P}/products?module=produce`)).body.data.total).toBe(0);
        expect((await api().get(`${P}/categories?module=produce`)).status).toBe(404);
    });
});
