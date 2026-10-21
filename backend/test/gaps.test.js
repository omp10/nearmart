/** Delete guards, staff alerts and staff lock status. */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff } from './helpers.js';
import { Notification } from '../src/modules/notifications/notification.model.js';
import { SlotRule } from '../src/modules/slots/slot.model.js';
import { Zone } from '../src/modules/zones/zone.model.js';

const auth = (t) => ({ Authorization: `Bearer ${t}` });
let admin;
let zone;
let product;
let customer;
let addressId;

beforeEach(async () => {
    admin = (await loginStaff(await createStaff())).token;
    zone = await Zone.create({ name: 'Kothrud', modules: ['grocery', 'laundry'], pincodes: ['411038'] });
    const post = async (p, body) => (await api().post(`/api/v1/admin${p}`).set(auth(admin)).send(body).expect(201)).body.data;
    const cat = await post('/catalog/categories', { module: 'grocery', name: 'Staples' });
    product = await post('/catalog/products', { module: 'grocery', category: cat._id, name: 'Atta', variants: [{ label: '1 kg', pricePaise: 5000, stockQty: 10 }] });
    customer = (await loginCustomer()).accessToken;
    addressId = (await api().post('/api/v1/me/addresses').set(auth(customer)).send({ line1: '12 Road', city: 'Pune', state: 'MH', pincode: '411038' })).body.data._id;
});

const placeOrder = async () => {
    await api().put('/api/v1/cart/items').set(auth(customer)).send({ productId: product._id, variantId: product.variants[0]._id, qty: 1 }).expect(200);
    const res = await api().post('/api/v1/checkout').set(auth(customer)).send({ module: 'grocery', addressId, paymentMethod: 'cod' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data.order;
};

describe('delete guards', () => {
    it('refuses to delete an ordered product, but deletes an unordered one', async () => {
        await placeOrder();
        const res = await api().delete(`/api/v1/admin/catalog/products/${product._id}`).set(auth(admin));
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/Visible to customers/);

        const cat = (await api().get('/api/v1/admin/catalog/categories?module=grocery').set(auth(admin))).body.data[0];
        const spare = (await api().post('/api/v1/admin/catalog/products').set(auth(admin)).send({ module: 'grocery', category: cat._id, name: 'Spare', variants: [{ label: 'x', pricePaise: 100 }] })).body.data;
        await api().delete(`/api/v1/admin/catalog/products/${spare._id}`).set(auth(admin)).expect(200);
    });

    it('refuses to delete a service area with orders or slot rules', async () => {
        await placeOrder();
        expect((await api().delete(`/api/v1/admin/zones/${zone._id}`).set(auth(admin))).status).toBe(409);

        const empty = await Zone.create({ name: 'Baner', modules: ['grocery'], pincodes: ['411045'] });
        const rule = await SlotRule.create({ module: 'grocery', kind: 'delivery', zone: empty._id, daysOfWeek: [1], start: '09:00', end: '10:00', capacity: 1 });
        expect((await api().delete(`/api/v1/admin/zones/${empty._id}`).set(auth(admin))).status).toBe(409);
        await SlotRule.deleteOne({ _id: rule._id });
        await api().delete(`/api/v1/admin/zones/${empty._id}`).set(auth(admin)).expect(200);
    });
});

describe('staff alerts', () => {
    it('alerts staff who handle the module, not others', async () => {
        const grocer = await createStaff({ isSuperAdmin: false, role: 'ops', modules: ['grocery'], permissions: { orders: ['view'] } });
        const tvGuy = await createStaff({ isSuperAdmin: false, role: 'ops', modules: ['electronics'], permissions: { orders: ['view'] } });
        const noPerm = await createStaff({ isSuperAdmin: false, role: 'ops', modules: ['grocery'], permissions: { catalog: ['view'] } });
        const order = await placeOrder();

        const titles = async (staff) => (await Notification.find({ ownerKind: 'staff', ownerId: staff._id }).lean()).map((n) => n.title);
        await expect.poll(() => titles(grocer)).toEqual([`New order #${order.orderNumber}`]);
        expect(await titles(tvGuy)).toEqual([]);
        expect(await titles(noPerm)).toEqual([]);

        // Shows in the panel's inbox (the bell).
        const inbox = await api().get('/api/v1/notifications').set(auth((await loginStaff(grocer)).token));
        expect(inbox.body.data).toMatchObject({ unread: 1, items: [{ data: { orderId: order._id } }] });

        // Customer cancellation alerts too.
        await api().post(`/api/v1/orders/${order._id}/cancel`).set(auth(customer)).send({ reason: 'Ordered by mistake' }).expect(200);
        await expect.poll(() => titles(grocer)).toContain(`Order #${order.orderNumber} cancelled by customer`);
    });
});

describe('permission changes', () => {
    it('apply to an open session at once, without signing the person out', async () => {
        const ops = await createStaff({ isSuperAdmin: false, role: 'ops', modules: ['grocery'], permissions: { orders: ['view'] } });
        const { token } = await loginStaff(ops);
        expect((await api().get('/api/v1/admin/catalog/products').set(auth(token))).status).toBe(403);

        await api().patch(`/api/v1/admin/staff/${ops._id}`).set(auth(admin)).send({ permissions: { orders: ['view'], catalog: ['view'] } }).expect(200);
        expect((await api().get('/api/v1/admin/catalog/products').set(auth(token))).status).toBe(200);

        // And taking it away is just as immediate.
        await api().patch(`/api/v1/admin/staff/${ops._id}`).set(auth(admin)).send({ permissions: { orders: ['view'] } }).expect(200);
        expect((await api().get('/api/v1/admin/catalog/products').set(auth(token))).status).toBe(403);
    });
});

describe('staff list', () => {
    it('reports locked accounts', async () => {
        const target = await createStaff({ isSuperAdmin: false, role: 'ops', email: 'locked@nearmart.test' });
        for (let i = 0; i < 8; i += 1) await api().post('/api/v1/auth/staff/login').send({ email: target.email, password: 'nope' });
        const list = await api().get('/api/v1/admin/staff').set(auth(admin));
        expect(list.body.data.find((s) => s.email === 'locked@nearmart.test').lockedUntil).toBeTruthy();
    });
});
