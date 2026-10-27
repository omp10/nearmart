import { beforeEach, describe, expect, it } from 'vitest';
import { OfferCard } from '../src/modules/offers/offerCard.model.js';
import { api, createStaff, loginStaff } from './helpers.js';

describe('offer cards API', () => {
    let adminToken;

    beforeEach(async () => {
        const staff = await createStaff({ role: 'admin' });
        const { token } = await loginStaff(staff);
        adminToken = token;
    });

    const asAdmin = () => ({ Authorization: `Bearer ${adminToken}` });

    it('creates, lists, edits, reorders, toggles and deletes offer cards as admin', async () => {
        // Validation: missing required fields
        const bad = await api().post('/api/v1/admin/offer-cards').set(asAdmin()).send({ title: 'Bad' });
        expect(bad.status).toBe(400);

        // Create Grocery card 1
        const res1 = await api().post('/api/v1/admin/offer-cards').set(asAdmin()).send({
            module: 'grocery',
            title: 'Beverages',
            label: 'UP TO',
            discountText: '12% OFF',
            image: '/uploads/offers/beverages.webp',
            backgroundColor: '#D1FAE5',
            link: { type: 'search', value: 'Beverages' },
            sortOrder: 1,
            isActive: true
        });
        expect(res1.status).toBe(201);
        const card1Id = res1.body.data._id;
        expect(card1Id).toBeTruthy();

        // Create Grocery card 2
        const res2 = await api().post('/api/v1/admin/offer-cards').set(asAdmin()).send({
            module: 'grocery',
            title: 'Oils & Ghee',
            label: 'UP TO',
            discountText: '10% OFF',
            image: '/uploads/offers/oils-ghee.webp',
            backgroundColor: '#FFEDD5',
            link: { type: 'search', value: 'Oils & Ghee' },
            sortOrder: 2,
            isActive: true
        });
        expect(res2.status).toBe(201);
        const card2Id = res2.body.data._id;

        // Create Inactive card
        await api().post('/api/v1/admin/offer-cards').set(asAdmin()).send({
            module: 'grocery',
            title: 'Hidden Staples',
            label: 'UP TO',
            discountText: '10% OFF',
            image: '/uploads/offers/staples.webp',
            sortOrder: 3,
            isActive: false
        }).expect(201);

        // Create card for fresh produce
        await api().post('/api/v1/admin/offer-cards').set(asAdmin()).send({
            module: 'produce',
            title: 'Fresh fruits',
            label: 'UP TO',
            discountText: '15% OFF',
            image: '/uploads/offers/fresh-fruits.webp',
            backgroundColor: '#DCFCE7',
            sortOrder: 1,
            isActive: true
        }).expect(201);

        // Admin list for grocery
        const adminList = await api().get('/api/v1/admin/offer-cards?module=grocery').set(asAdmin());
        expect(adminList.status).toBe(200);
        expect(adminList.body.data.length).toBe(3);

        // Edit card 1
        const patchRes = await api().patch(`/api/v1/admin/offer-cards/${card1Id}`).set(asAdmin()).send({
            discountText: '15% OFF'
        });
        expect(patchRes.status).toBe(200);
        expect(patchRes.body.data.discountText).toBe('15% OFF');

        // Reorder cards
        const reorderRes = await api().put('/api/v1/admin/offer-cards/reorder').set(asAdmin()).send({
            items: [
                { id: card1Id, sortOrder: 5 },
                { id: card2Id, sortOrder: 1 }
            ]
        });
        expect(reorderRes.status).toBe(200);

        // Public API for grocery: should return active cards only, sorted by sortOrder (Oils & Ghee first, then Beverages)
        const pubGrocery = await api().get('/api/v1/offer-cards?module=grocery');
        expect(pubGrocery.status).toBe(200);
        expect(pubGrocery.body.data.length).toBe(2);
        expect(pubGrocery.body.data[0].title).toBe('Oils & Ghee');
        expect(pubGrocery.body.data[1].title).toBe('Beverages');
        expect(pubGrocery.body.data[1].discountText).toBe('15% OFF');

        // Public API for produce
        const pubProduce = await api().get('/api/v1/offer-cards?module=produce');
        expect(pubProduce.status).toBe(200);
        expect(pubProduce.body.data.length).toBe(1);
        expect(pubProduce.body.data[0].title).toBe('Fresh fruits');

        // Delete card 2
        const delRes = await api().delete(`/api/v1/admin/offer-cards/${card2Id}`).set(asAdmin());
        expect(delRes.status).toBe(200);

        const pubAfterDel = await api().get('/api/v1/offer-cards?module=grocery');
        expect(pubAfterDel.body.data.length).toBe(1);
        expect(pubAfterDel.body.data[0].title).toBe('Beverages');
    });

    it('respects scheduling startsAt and endsAt dates in public API', async () => {
        const now = Date.now();
        // Scheduled for future
        await api().post('/api/v1/admin/offer-cards').set(asAdmin()).send({
            module: 'laundry',
            title: 'Future Deal',
            label: 'UP TO',
            discountText: '30% OFF',
            image: '/uploads/offers/beverages.webp',
            startsAt: new Date(now + 3600_000).toISOString(),
            isActive: true
        }).expect(201);

        // Expired in past
        await api().post('/api/v1/admin/offer-cards').set(asAdmin()).send({
            module: 'laundry',
            title: 'Past Deal',
            label: 'UP TO',
            discountText: '50% OFF',
            image: '/uploads/offers/beverages.webp',
            endsAt: new Date(now - 3600_000).toISOString(),
            isActive: true
        }).expect(201);

        // Active now
        await api().post('/api/v1/admin/offer-cards').set(asAdmin()).send({
            module: 'laundry',
            title: 'Current Deal',
            label: 'UP TO',
            discountText: '20% OFF',
            image: '/uploads/offers/beverages.webp',
            startsAt: new Date(now - 3600_000).toISOString(),
            endsAt: new Date(now + 3600_000).toISOString(),
            isActive: true
        }).expect(201);

        const pub = await api().get('/api/v1/offer-cards?module=laundry');
        expect(pub.status).toBe(200);
        expect(pub.body.data.length).toBe(1);
        expect(pub.body.data[0].title).toBe('Current Deal');
    });
});
