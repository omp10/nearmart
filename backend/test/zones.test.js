import { beforeEach, describe, expect, it } from 'vitest';
import { api, createStaff, loginCustomer, loginStaff } from './helpers.js';

// A square around central Pune (lng, lat), and points inside / outside it.
const PUNE = { type: 'Polygon', coordinates: [[[73.8, 18.48], [73.9, 18.48], [73.9, 18.56], [73.8, 18.56], [73.8, 18.48]]] };
const INSIDE = { lat: 18.52, lng: 73.85 };
const OUTSIDE = { lat: 19.07, lng: 72.87 };

let admin;
beforeEach(async () => {
    const { token } = await loginStaff(await createStaff());
    admin = { Authorization: `Bearer ${token}` };
});

const createZone = async (body) => {
    const res = await api().post('/api/v1/admin/zones').set(admin).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data;
};

describe('service areas', () => {
    it('matches by pincode or by polygon, per module', async () => {
        await createZone({ name: 'Kothrud', modules: ['grocery', 'produce'], pincodes: ['411038', '411029'] });
        await createZone({ name: 'Pune laundry', modules: ['laundry'], polygon: PUNE });

        const byPin = await api().get('/api/v1/serviceability?pincode=411038');
        expect(byPin.body.data).toEqual({ serviceable: true, modules: ['grocery', 'produce'] });

        const byPoint = await api().get(`/api/v1/serviceability?lat=${INSIDE.lat}&lng=${INSIDE.lng}`);
        expect(byPoint.body.data.modules).toEqual(['laundry']);

        const both = await api().get(`/api/v1/serviceability?pincode=411038&lat=${INSIDE.lat}&lng=${INSIDE.lng}`);
        expect(both.body.data.modules).toEqual(['grocery', 'laundry', 'produce']);

        const nowhere = await api().get(`/api/v1/serviceability?pincode=400001&lat=${OUTSIDE.lat}&lng=${OUTSIDE.lng}`);
        expect(nowhere.body.data).toEqual({ serviceable: false, modules: [] });
    });

    it('ignores inactive zones and modules switched off in the catalogue', async () => {
        const zone = await createZone({ name: 'Baner', modules: ['grocery', 'electronics'], pincodes: ['411045'] });
        await api().patch('/api/v1/admin/catalog/modules/electronics').set(admin).send({ isActive: false }).expect(200);
        expect((await api().get('/api/v1/serviceability?pincode=411045')).body.data.modules).toEqual(['grocery']);

        await api().patch(`/api/v1/admin/zones/${zone._id}`).set(admin).send({ isActive: false }).expect(200);
        expect((await api().get('/api/v1/serviceability?pincode=411045')).body.data.serviceable).toBe(false);
    });

    it('validates zone input', async () => {
        const post = (body) => api().post('/api/v1/admin/zones').set(admin).send(body);
        expect((await post({ name: 'Empty', modules: ['grocery'] })).status).toBe(400);
        expect((await post({ name: 'Bad pin', modules: ['grocery'], pincodes: ['4110'] })).status).toBe(400);
        const open = { type: 'Polygon', coordinates: [[[73.8, 18.48], [73.9, 18.48], [73.9, 18.56], [73.8, 18.56]]] };
        expect((await post({ name: 'Open ring', modules: ['grocery'], polygon: open })).status).toBe(400);
        const bowtie = { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] };
        const crossed = await post({ name: 'Bowtie', modules: ['grocery'], polygon: bowtie });
        expect(crossed.status).toBe(400);
        expect(crossed.body.message).toMatch(/polygon/i);
    });

    it('lets admins test a location against all zones', async () => {
        await createZone({ name: 'Kothrud', modules: ['grocery'], pincodes: ['411038'], priority: 2 });
        await createZone({ name: 'Pune', modules: ['grocery', 'laundry'], polygon: PUNE, priority: 1 });
        const res = await api().post('/api/v1/admin/zones/check').set(admin).send({ pincode: '411038', ...INSIDE });
        expect(res.body.data.matches.map((m) => m.name)).toEqual(['Pune', 'Kothrud']);
    });

    it('keeps zone edits to admins', async () => {
        const ops = await createStaff({ role: 'ops', isSuperAdmin: false, modules: ['grocery'], permissions: { zones: ['view', 'create', 'update'] } });
        const { token } = await loginStaff(ops);
        const res = await api().post('/api/v1/admin/zones').set({ Authorization: `Bearer ${token}` }).send({ name: 'X', modules: ['grocery'], pincodes: ['411001'] });
        expect(res.status).toBe(403);
    });
});

describe('customer profile and addresses', () => {
    let customer;
    beforeEach(async () => {
        await createZone({ name: 'Kothrud', modules: ['grocery'], pincodes: ['411038'] });
        await createZone({ name: 'Pune laundry', modules: ['laundry'], polygon: PUNE });
        const session = await loginCustomer();
        customer = { Authorization: `Bearer ${session.accessToken}` };
    });

    const home = { label: 'home', line1: '12 Paud Road', city: 'Pune', state: 'Maharashtra', pincode: '411038' };

    it('updates the profile', async () => {
        const res = await api().patch('/api/v1/me').set(customer).send({ name: 'Asha', email: 'Asha@Example.com', preferences: { notifications: false } });
        expect(res.body.data).toMatchObject({ name: 'Asha', email: 'asha@example.com', preferences: { notifications: false } });
    });

    it('saves addresses with serviceability and keeps exactly one default', async () => {
        const first = await api().post('/api/v1/me/addresses').set(customer).send(home);
        expect(first.status).toBe(201);
        expect(first.body.data).toMatchObject({ isDefault: true, serviceableModules: ['grocery'] });

        const second = await api().post('/api/v1/me/addresses').set(customer)
            .send({ ...home, label: 'work', pincode: '411001', ...INSIDE, isDefault: true });
        expect(second.body.data.serviceableModules).toEqual(['laundry']);
        expect(second.body.data.location.coordinates).toEqual([INSIDE.lng, INSIDE.lat]);

        let list = (await api().get('/api/v1/me/addresses').set(customer)).body.data;
        expect(list.map((a) => [a.label, a.isDefault])).toEqual([['home', false], ['work', true]]);

        await api().delete(`/api/v1/me/addresses/${second.body.data._id}`).set(customer).expect(200);
        list = (await api().get('/api/v1/me/addresses').set(customer)).body.data;
        expect(list.map((a) => [a.label, a.isDefault])).toEqual([['home', true]]);
    });

    it('validates addresses and clears a map pin', async () => {
        const bad = await api().post('/api/v1/me/addresses').set(customer).send({ ...home, pincode: '12' });
        expect(bad.status).toBe(400);
        const half = await api().post('/api/v1/me/addresses').set(customer).send({ ...home, lat: 18.5 });
        expect(half.status).toBe(400);

        const saved = await api().post('/api/v1/me/addresses').set(customer).send({ ...home, ...INSIDE });
        const cleared = await api().patch(`/api/v1/me/addresses/${saved.body.data._id}`).set(customer).send({ lat: null, lng: null });
        expect(cleared.status).toBe(200);
        expect(cleared.body.data.location).toBeUndefined();
        expect(cleared.body.data.serviceableModules).toEqual(['grocery']);
    });

    it('is customers only', async () => {
        expect((await api().get('/api/v1/me/addresses').set(admin)).status).toBe(403);
    });
});
