import { beforeEach, describe, expect, it } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff } from './helpers.js';
import { istDate } from '../src/lib/istTime.js';
import { Zone } from '../src/modules/zones/zone.model.js';

const as = (t) => ({ Authorization: `Bearer ${t}` });
let admin;
let customer;
let addressId;
let atta;
let tv;

beforeEach(async () => {
    admin = (await loginStaff(await createStaff())).token;
    await Zone.create({ name: 'Kothrud', modules: ['grocery', 'electronics'], pincodes: ['411038'], deliveryFeePaise: 2000 });
    const post = async (path, body) => (await api().post(`/api/v1/admin${path}`).set(as(admin)).send(body).expect(201)).body.data;
    const staples = await post('/catalog/categories', { module: 'grocery', name: 'Staples' });
    const flours = await post('/catalog/categories', { module: 'grocery', name: 'Flours', parent: staples._id });
    const tvs = await post('/catalog/categories', { module: 'electronics', name: 'TVs' });
    atta = await post('/catalog/products', { module: 'grocery', category: flours._id, name: 'Atta', variants: [{ sku: 'A1', label: '1 kg', pricePaise: 5000, stockQty: 20, lowStockThreshold: 5 }, { label: '5 kg', pricePaise: 20000, stockQty: 2 }] });
    tv = await post('/catalog/products', { module: 'electronics', category: tvs._id, name: 'TV', variants: [{ label: '43"', pricePaise: 2000000, stockQty: 0 }] });

    customer = (await loginCustomer()).accessToken;
    await api().patch('/api/v1/me').set(as(customer)).send({ name: '=HYPERLINK("http://evil")' });
    addressId = (await api().post('/api/v1/me/addresses').set(as(customer)).send({ name: '=HYPERLINK("http://evil")', line1: '12 Paud Road', city: 'Pune', state: 'MH', pincode: '411038' })).body.data._id;
});

const order = async (qty = 2, extra = {}) => {
    await api().put('/api/v1/cart/items').set(as(customer)).send({ productId: atta._id, variantId: atta.variants[0]._id, qty }).expect(200);
    return api().post('/api/v1/checkout').set(as(customer)).send({ module: 'grocery', addressId, paymentMethod: 'cod', ...extra });
};

describe('settings', () => {
    it('serves defaults publicly and merges updates by section', async () => {
        const initial = await api().get('/api/v1/settings');
        expect(initial.body.data).toMatchObject({ acceptingOrders: true, payments: { cod: true, online: true } });

        await api().patch('/api/v1/admin/settings').set(as(admin)).send({ contact: { phone: '020-1234567', email: 'help@nearmart.test' } }).expect(200);
        await api().patch('/api/v1/admin/settings').set(as(admin)).send({ policies: { refund: 'Refunds within 7 days.' } }).expect(200);
        const after = await api().get('/api/v1/settings');
        expect(after.body.data.contact).toMatchObject({ phone: '020-1234567', email: 'help@nearmart.test' });
        expect(after.body.data.policies.refund).toBe('Refunds within 7 days.');
    });

    it('pauses orders and limits cash on delivery', async () => {
        await api().patch('/api/v1/admin/settings').set(as(admin)).send({ operations: { acceptingOrders: false, pausedMessage: 'Closed for Diwali, back on Monday' } });
        const paused = await order();
        expect(paused.status).toBe(400);
        expect(paused.body.message).toBe('Closed for Diwali, back on Monday');

        await api().patch('/api/v1/admin/settings').set(as(admin)).send({ operations: { acceptingOrders: true }, orders: { codMaxOrderPaise: 10000 } });
        const big = await order(3); // 15000 + 2000 fee
        expect(big.body.message).toMatch(/up to ₹100/);

        await api().patch('/api/v1/admin/settings').set(as(admin)).send({ orders: { codEnabled: false, codMaxOrderPaise: null } });
        expect((await order(1)).body.message).toMatch(/Cash on delivery is not available/);
    });

    it('stores the Google Maps key for the apps and validates it', async () => {
        const key = `AIza${'x'.repeat(35)}`;
        expect((await api().patch('/api/v1/admin/settings').set(as(admin)).send({ maps: { googleApiKey: 'not-a-key' } })).status).toBe(400);
        await api().patch('/api/v1/admin/settings').set(as(admin)).send({ maps: { googleApiKey: key } }).expect(200);
        expect((await api().get('/api/v1/settings')).body.data.maps).toEqual({ googleApiKey: key });
        await api().patch('/api/v1/admin/settings').set(as(admin)).send({ maps: { googleApiKey: '' } }).expect(200);
        expect((await api().get('/api/v1/settings')).body.data.maps).toEqual({ googleApiKey: '' });
    });

    it('is admin only', async () => {
        const ops = await createStaff({ role: 'ops', isSuperAdmin: false, modules: ['grocery'], permissions: { settings: ['view', 'update'] } });
        const token = (await loginStaff(ops)).token;
        expect((await api().get('/api/v1/admin/settings').set(as(token))).status).toBe(403);
    });
});

describe('banners', () => {
    it('validates links and shows only live banners for a placement', async () => {
        const post = (body) => api().post('/api/v1/admin/banners').set(as(admin)).send({ title: 'B', image: '/uploads/banners/x.webp', ...body });
        expect((await post({ link: { type: 'url', value: 'http://insecure.example' } })).status).toBe(400);
        expect((await post({ link: { type: 'product', value: 'nope' } })).status).toBe(400);

        await post({ title: 'Diwali sale', link: { type: 'module', value: 'grocery' }, sortOrder: 2 }).expect(201);
        await post({ title: 'Atta deal', link: { type: 'product', value: atta._id }, sortOrder: 1 }).expect(201);
        await post({ title: 'Later', startsAt: new Date(Date.now() + 86400000).toISOString() }).expect(201);
        await post({ title: 'Off', isActive: false }).expect(201);
        await post({ title: 'Produce only', placement: 'produce' }).expect(201);

        const home = await api().get('/api/v1/banners');
        expect(home.body.data.map((b) => b.title)).toEqual(['Atta deal', 'Diwali sale']);
        const produce = await api().get('/api/v1/banners?placement=produce');
        expect(produce.body.data.map((b) => b.title)).toEqual(['Produce only']);
    });
});

describe('customer management', () => {
    it('lists customers with order stats and shows history', async () => {
        await order(2);
        const list = await api().get('/api/v1/admin/customers?q=98765').set(as(admin));
        expect(list.body.data.items).toHaveLength(1);
        expect(list.body.data.items[0]).toMatchObject({ phone: '9876543210', orders: 1, spentPaise: 12000 });

        const detail = await api().get(`/api/v1/admin/customers/${list.body.data.items[0]._id}`).set(as(admin));
        expect(detail.body.data.orders).toHaveLength(1);
        expect(detail.body.data.addresses).toHaveLength(1);
    });

    it('deactivating signs the customer out immediately', async () => {
        const list = await api().get('/api/v1/admin/customers').set(as(admin));
        const id = list.body.data.items[0]._id;
        await api().patch(`/api/v1/admin/customers/${id}`).set(as(admin)).send({ isActive: false }).expect(200);
        expect((await api().get('/api/v1/cart').set(as(customer))).status).toBe(401);
        expect((await api().get('/api/v1/admin/customers?status=inactive').set(as(admin))).body.data.total).toBe(1);
    });
});

describe('dashboard', () => {
    it('counts today, open orders, catalogue and customers, scoped for ops', async () => {
        await order(2);
        await order(1);
        const res = await api().get('/api/v1/admin/dashboard').set(as(admin));
        const d = res.body.data;
        expect(d.today).toMatchObject({ date: istDate(), orders: 2, revenuePaise: 12000 + 7000 });
        expect(d.week.daily).toHaveLength(7);
        expect(d.week.byModule.find((m) => m.module === 'grocery').orders).toBe(2);
        expect(d.openOrders).toMatchObject({ total: 2, needsAction: 2 });
        expect(d.catalogue.byModule.find((m) => m.module === 'electronics')).toMatchObject({ products: 1, outOfStock: 1 });
        expect(d.catalogue.lowStockVariants).toBe(2); // 5 kg atta (2) and the TV (0)
        expect(d.customers.total).toBe(1);

        const ops = await createStaff({ role: 'ops', isSuperAdmin: false, modules: ['electronics'], permissions: {} });
        const scoped = (await api().get('/api/v1/admin/dashboard').set(as((await loginStaff(ops)).token))).body.data;
        expect(scoped.today.orders).toBe(0);
        expect(scoped.catalogue.byModule.map((m) => m.module)).toEqual(['electronics']);
        expect(scoped.bookings).toBeNull();
    });

    it('narrows to one module, and ops cannot ask for a module they lack', async () => {
        await order(2);
        const get = (token, module) => api().get(`/api/v1/admin/dashboard?module=${module}`).set(as(token));

        const grocery = (await get(admin, 'grocery')).body.data;
        expect(grocery.today.orders).toBe(1);
        expect(grocery.week.byModule.map((m) => m.module)).toEqual(['grocery']);
        expect(grocery.catalogue.byModule.map((m) => m.module)).toEqual(['grocery']);
        expect(grocery.catalogue.lowStockVariants).toBe(1); // only the 5 kg atta; the TV is electronics
        expect(grocery.bookings).toBeNull();

        const electronics = (await get(admin, 'electronics')).body.data;
        expect(electronics.today.orders).toBe(0);
        expect(electronics.openOrders.total).toBe(0);
        expect(electronics.catalogue.byModule).toEqual([{ module: 'electronics', products: 1, active: 1, outOfStock: 1 }]);

        const laundry = (await get(admin, 'laundry')).body.data;
        expect(laundry.catalogue.byModule).toEqual([]);
        expect(laundry.bookings).toMatchObject({ open: 0 });
        expect(laundry.week.byModule.map((m) => m.module)).toEqual(['laundry']);

        expect((await get(admin, 'toys')).status).toBe(400);
        const ops = (await loginStaff(await createStaff({ role: 'ops', isSuperAdmin: false, modules: ['electronics'], permissions: {} }))).token;
        expect((await get(ops, 'grocery')).status).toBe(403);
        expect((await get(ops, 'electronics')).status).toBe(200);
    });
});

describe('reports', () => {
    const today = istDate();

    it('lists orders as JSON, CSV (formula-safe) and XLSX', async () => {
        await order(2, { couponCode: undefined });
        const json = await api().get(`/api/v1/admin/reports/orders?from=${today}&to=${today}`).set(as(admin));
        expect(json.body.data.rows).toHaveLength(1);
        expect(json.body.data.rows[0]).toMatchObject({ module: 'grocery', totalPaise: 12000, items: 2, status: 'placed' });

        const csv = await api().get(`/api/v1/admin/reports/orders?from=${today}&to=${today}&format=csv`).set(as(admin));
        expect(csv.headers['content-type']).toMatch(/text\/csv/);
        expect(csv.headers['content-disposition']).toContain(`nearmart-orders-${today}-to-${today}.csv`);
        expect(csv.text.charCodeAt(0)).toBe(0xfeff);
        expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
        expect(csv.text).toContain(',120.00,');

        const xlsx = await api().get(`/api/v1/admin/reports/orders?format=xlsx`).set(as(admin)).buffer(true).parse((res, cb) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
        expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
        expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
    });

    it('summarises sales, category orders and availability', async () => {
        await order(2);
        const second = await order(1);
        await api().post(`/api/v1/orders/${second.body.data.order._id}/cancel`).set(as(customer)).send({}).expect(200);

        const sales = (await api().get('/api/v1/admin/reports/sales').set(as(admin))).body.data.rows;
        expect(sales).toEqual([expect.objectContaining({ date: today, module: 'grocery', orders: 1, cancelled: 1, grossPaise: 10000, deliveryFeePaise: 2000, netPaise: 12000, avgOrderPaise: 12000 })]);

        const cats = (await api().get('/api/v1/admin/reports/category-orders').set(as(admin))).body.data.rows;
        expect(cats).toEqual([{ module: 'grocery', category: 'Staples', orders: 1, units: 2, valuePaise: 10000 }]);

        const avail = (await api().get('/api/v1/admin/reports/availability?module=electronics').set(as(admin))).body.data;
        expect(avail.range).toBeNull();
        expect(avail.rows).toEqual([expect.objectContaining({ product: 'TV', state: 'Out of stock', stock: 0 })]);
    });

    it('validates ranges and module access', async () => {
        expect((await api().get('/api/v1/admin/reports/orders?from=2026-02-30').set(as(admin))).status).toBe(400);
        expect((await api().get('/api/v1/admin/reports/orders?from=2026-10-10&to=2026-10-01').set(as(admin))).status).toBe(400);
        expect((await api().get('/api/v1/admin/reports/orders?from=2024-01-01&to=2026-01-01').set(as(admin))).status).toBe(400);
        expect((await api().get('/api/v1/admin/reports/nope').set(as(admin))).status).toBe(400);

        const ops = await createStaff({ role: 'ops', isSuperAdmin: false, modules: ['laundry'], permissions: { reports: ['view'] } });
        const token = (await loginStaff(ops)).token;
        expect((await api().get('/api/v1/admin/reports/orders').set(as(token))).status).toBe(400);
        expect((await api().get('/api/v1/admin/reports/bookings').set(as(token))).status).toBe(200);
    });
});
