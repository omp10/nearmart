import { beforeEach, describe, expect, it } from 'vitest';
import { api, createStaff, loginStaff } from './helpers.js';
import { Product } from '../src/modules/catalog/product.model.js';
import { StockMovement } from '../src/modules/catalog/stockMovement.model.js';
import { adjustStock } from '../src/modules/catalog/stock.service.js';

let token;
const auth = () => ({ Authorization: `Bearer ${token}` });
const A = '/api/v1/admin/catalog';

beforeEach(async () => {
    ({ token } = await loginStaff(await createStaff()));
});

const createCategory = async (body) => {
    const res = await api().post(`${A}/categories`).set(auth()).send(body);
    expect(res.status, res.body.message).toBe(201);
    return res.body.data;
};

const atta = (category, overrides = {}) => ({
    module: 'grocery',
    category,
    name: 'Whole Wheat Atta',
    brand: 'Aashirvaad',
    variants: [
        { sku: 'ATTA-1', label: '1 kg', unit: 'kg', unitQty: 1, pricePaise: 6500, offerPricePaise: 5900, stockQty: 10 },
        { sku: 'ATTA-5', label: '5 kg', unit: 'kg', unitQty: 5, pricePaise: 29000, stockQty: 0 }
    ],
    ...overrides
});

const createProduct = async (body) => {
    const res = await api().post(`${A}/products`).set(auth()).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data;
};

describe('categories', () => {
    it('builds a nested tree and enforces the depth limit', async () => {
        const staples = await createCategory({ module: 'grocery', name: 'Staples' });
        const flours = await createCategory({ module: 'grocery', name: 'Flours', parent: staples._id });
        const wheat = await createCategory({ module: 'grocery', name: 'Wheat', parent: flours._id });
        expect(wheat.ancestors).toEqual([staples._id, flours._id]);

        const tooDeep = await api().post(`${A}/categories`).set(auth()).send({ module: 'grocery', name: 'X', parent: wheat._id });
        expect(tooDeep.status).toBe(400);

        const tree = await api().get(`${A}/categories?module=grocery`).set(auth());
        expect(tree.body.data[0].children[0].children[0].name).toBe('Wheat');
    });

    it('rejects a parent from another module and moving a category under itself', async () => {
        const g = await createCategory({ module: 'grocery', name: 'Snacks' });
        const child = await createCategory({ module: 'grocery', name: 'Chips', parent: g._id });
        const cross = await api().post(`${A}/categories`).set(auth()).send({ module: 'produce', name: 'X', parent: g._id });
        expect(cross.status).toBe(400);
        const loop = await api().patch(`${A}/categories/${g._id}`).set(auth()).send({ parent: child._id });
        expect(loop.status).toBe(400);
    });

    it('moving a category updates its subtree and product paths', async () => {
        const a = await createCategory({ module: 'grocery', name: 'A' });
        const b = await createCategory({ module: 'grocery', name: 'B' });
        const a1 = await createCategory({ module: 'grocery', name: 'A1', parent: a._id });
        const product = await createProduct(atta(a1._id));

        const moved = await api().patch(`${A}/categories/${a._id}`).set(auth()).send({ parent: b._id });
        expect(moved.status).toBe(200);

        const listUnderB = await api().get(`${A}/products?category=${b._id}`).set(auth());
        expect(listUnderB.body.data.items.map((p) => p._id)).toContain(product._id);
        const stored = await Product.findById(product._id).lean();
        expect(stored.categoryPath.map(String)).toEqual([b._id, a._id, a1._id]);
    });

    it('refuses to delete a category with products or children', async () => {
        const parent = await createCategory({ module: 'grocery', name: 'Parent' });
        const leaf = await createCategory({ module: 'grocery', name: 'Leaf', parent: parent._id });
        await createProduct(atta(leaf._id));
        expect((await api().delete(`${A}/categories/${parent._id}`).set(auth())).status).toBe(409);
        expect((await api().delete(`${A}/categories/${leaf._id}`).set(auth())).status).toBe(409);
    });
});

describe('products', () => {
    let cat;
    beforeEach(async () => {
        cat = await createCategory({ module: 'grocery', name: 'Flours' });
    });

    it('stores variants, derives price/stock and logs opening stock', async () => {
        const p = await createProduct(atta(cat._id));
        expect(p).toMatchObject({ minPricePaise: 5900, totalStock: 10, inStock: true, slug: 'whole-wheat-atta' });
        expect(p.categoryPath).toEqual([cat._id]);
        const moves = await StockMovement.find({ product: p._id }).lean();
        expect(moves).toHaveLength(1);
        expect(moves[0]).toMatchObject({ reason: 'initial', delta: 10, after: 10, sku: 'ATTA-1' });
    });

    it('validates offer price, SKU uniqueness and module/category match', async () => {
        const badOffer = atta(cat._id, { variants: [{ label: '1 kg', pricePaise: 100, offerPricePaise: 200 }] });
        expect((await api().post(`${A}/products`).set(auth()).send(badOffer)).status).toBe(400);

        await createProduct(atta(cat._id));
        const dupSku = await api().post(`${A}/products`).set(auth()).send(atta(cat._id, { name: 'Other' }));
        expect(dupSku.status).toBe(409);

        const wrongModule = await api().post(`${A}/products`).set(auth()).send(atta(cat._id, { module: 'electronics', name: 'TV' }));
        expect(wrongModule.status).toBe(400);

        const laundry = await api().post(`${A}/products`).set(auth()).send(atta(cat._id, { module: 'laundry' }));
        expect(laundry.status).toBe(400);
    });

    it('editing never overwrites stock, even from a stale form', async () => {
        const p = await createProduct(atta(cat._id));
        const v1 = p.variants[0];
        // A sale happens after the admin opened the form.
        await adjustStock({ productId: p._id, variantId: v1._id, delta: -3, reason: 'adjustment' });

        const res = await api()
            .patch(`${A}/products/${p._id}`)
            .set(auth())
            .send({
                name: 'Whole Wheat Atta (Chakki Fresh)',
                variants: [
                    { ...v1, stockQty: 999, pricePaise: 7000, offerPricePaise: null },
                    { label: '10 kg', unit: 'kg', unitQty: 10, pricePaise: 55000, stockQty: 4 }
                ]
            });
        expect(res.status, res.body.message).toBe(200);

        const stored = await Product.findById(p._id).lean();
        expect(stored.variants).toHaveLength(2); // the 5 kg variant was removed by the edit
        expect(stored.variants[0].stockQty).toBe(7);
        expect(stored.variants[0].pricePaise).toBe(7000);
        expect(stored.variants[1].stockQty).toBe(4);
        expect(stored.totalStock).toBe(11);
        expect(stored.slug).toBe('whole-wheat-atta-chakki-fresh');
        expect(await StockMovement.countDocuments({ product: p._id, reason: 'initial' })).toBe(2);
    });

    it('a stock change makes an older in-memory copy of the product unsaveable', async () => {
        const p = await createProduct(atta(cat._id));
        const stale = await Product.findById(p._id);
        await adjustStock({ productId: p._id, variantId: p.variants[0]._id, delta: -1, reason: 'adjustment' });

        stale.variants[0].label = '1 kg pouch';
        await expect(stale.save()).rejects.toThrow(/version/i);
        expect((await Product.findById(p._id).lean()).variants[0].stockQty).toBe(9);
    });

    it('lists with search by SKU and stock filters', async () => {
        await createProduct(atta(cat._id));
        await createProduct(atta(cat._id, {
            name: 'Basmati Rice', brand: 'India Gate',
            variants: [{ sku: 'RICE-1', label: '1 kg', pricePaise: 12000, stockQty: 0 }]
        }));

        const bySku = await api().get(`${A}/products?q=rice-1`).set(auth());
        expect(bySku.body.data.items.map((p) => p.name)).toEqual(['Basmati Rice']);
        const out = await api().get(`${A}/products?stock=out`).set(auth());
        expect(out.body.data.items.map((p) => p.name)).toEqual(['Basmati Rice']);
        const low = await api().get(`${A}/products?stock=low`).set(auth());
        expect(low.body.data.total).toBe(2); // atta's 5 kg variant is at 0
    });
});

describe('inventory', () => {
    let product;
    beforeEach(async () => {
        const cat = await createCategory({ module: 'grocery', name: 'Flours' });
        product = await createProduct(atta(cat._id));
    });

    const variantUrl = (v) => `${A}/inventory/${product._id}/variants/${v._id}`;

    it('adjusts and sets stock with a ledger entry each time', async () => {
        const v = product.variants[0];
        const add = await api().post(`${variantUrl(v)}/adjust`).set(auth()).send({ delta: 5, reason: 'restock', note: 'PO-12' });
        expect(add.body.data.stockQty).toBe(15);
        const set = await api().put(`${variantUrl(v)}/stock`).set(auth()).send({ quantity: 12 });
        expect(set.body.data.stockQty).toBe(12);

        const moves = await api().get(`${A}/inventory/movements?productId=${product._id}`).set(auth());
        expect(moves.body.data.items.map((m) => [m.reason, m.delta, m.after])).toEqual([
            ['adjustment', -3, 12],
            ['restock', 5, 15],
            ['initial', 10, 10]
        ]);
    });

    it('never goes below zero, even under concurrent decrements', async () => {
        const v = product.variants[0];
        const results = await Promise.allSettled(
            Array.from({ length: 8 }, () => adjustStock({ productId: product._id, variantId: v._id, delta: -2, reason: 'adjustment' }))
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
        const stored = await Product.findById(product._id).lean();
        expect(stored.variants[0].stockQty).toBe(0);
        expect(stored.inStock).toBe(false);
    });

    it('lists variants lowest stock first', async () => {
        const res = await api().get(`${A}/inventory`).set(auth());
        expect(res.body.data.items.map((r) => [r.label, r.stockQty])).toEqual([['5 kg', 0], ['1 kg', 10]]);
    });
});

describe('ops users', () => {
    it('only see and edit their assigned modules', async () => {
        const groceryCat = await createCategory({ module: 'grocery', name: 'Flours' });
        const tvCat = await createCategory({ module: 'electronics', name: 'TVs' });
        await createProduct(atta(groceryCat._id));
        const tv = await createProduct({
            module: 'electronics', category: tvCat._id, name: 'Smart TV 43"', brand: 'Acme', warranty: '1 year',
            specifications: [{ key: 'Screen', value: '43 inch' }],
            variants: [{ label: 'Black', options: { colour: 'Black' }, pricePaise: 2500000, stockQty: 2 }]
        });

        const ops = await createStaff({
            role: 'ops', isSuperAdmin: false, modules: ['grocery'],
            permissions: { catalog: ['view', 'update'], inventory: ['view', 'update'] }
        });
        const { token: opsToken } = await loginStaff(ops);
        const opsAuth = { Authorization: `Bearer ${opsToken}` };

        const list = await api().get(`${A}/products`).set(opsAuth);
        expect(list.body.data.items.map((p) => p.module)).toEqual(['grocery']);
        expect((await api().get(`${A}/products/${tv._id}`).set(opsAuth)).status).toBe(403);
        expect((await api().get(`${A}/products?module=electronics`).set(opsAuth)).status).toBe(403);
        const adjust = await api()
            .post(`${A}/inventory/${tv._id}/variants/${tv.variants[0]._id}/adjust`)
            .set(opsAuth)
            .send({ delta: 1, reason: 'restock' });
        expect(adjust.status).toBe(403);
        const create = await api().post(`${A}/products`).set(opsAuth).send(atta(groceryCat._id, { name: 'New', variants: [{ label: 'x', pricePaise: 100 }] }));
        expect(create.status).toBe(403); // no catalog:create permission
        expect((await api().patch(`${A}/modules/grocery`).set(opsAuth).send({ isActive: false })).status).toBe(403);
    });
});
