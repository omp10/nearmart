import { beforeEach, describe, expect, it } from 'vitest';
import { api, createStaff, loginStaff } from './helpers.js';
import { SlotBlackout, SlotRule } from '../src/modules/slots/slot.model.js';
import { generateSlots, releaseSlot, reserveSlot, resolveSlot } from '../src/modules/slots/slot.service.js';
import { Zone } from '../src/modules/zones/zone.model.js';
import { addDays, istDate, istInstant, weekday } from '../src/lib/istTime.js';

// Monday 19 Oct 2026, 09:00 IST.
const NOW = new Date('2026-10-19T03:30:00Z');
const MON_TO_SAT = [1, 2, 3, 4, 5, 6];

let zone;
let morning;
let afternoon;
beforeEach(async () => {
    zone = await Zone.create({ name: 'Kothrud', modules: ['grocery', 'laundry'], pincodes: ['411038'] });
    morning = await SlotRule.create({ module: 'grocery', kind: 'delivery', daysOfWeek: MON_TO_SAT, start: '10:00', end: '12:00', capacity: 2, cutoffMinutes: 60 });
    afternoon = await SlotRule.create({ module: 'grocery', kind: 'delivery', daysOfWeek: MON_TO_SAT, start: '14:00', end: '16:00', capacity: 2, cutoffMinutes: 60 });
});

const ctx = { module: 'grocery', kind: 'delivery', now: NOW };

describe('IST helpers', () => {
    it('handles dates and wall-clock times in IST', () => {
        expect(istDate(new Date('2026-10-19T18:29:00Z'))).toBe('2026-10-19');
        expect(istDate(new Date('2026-10-19T18:30:00Z'))).toBe('2026-10-20');
        expect(weekday('2026-10-19')).toBe(1);
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(istInstant('2026-10-19', '10:00').toISOString()).toBe('2026-10-19T04:30:00.000Z');
    });
});

describe('slot generation', () => {
    it('drops slots past their cutoff and skips days a rule does not run', async () => {
        const days = await generateSlots({ ...ctx, zoneId: zone._id, days: 7 });
        expect(days.map((d) => d.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
        // 10:00 closes at 09:00, which is now: only the afternoon slot is left today.
        expect(days[0].slots.map((s) => s.label)).toEqual(['14:00–16:00']);
        expect(days[1].slots.map((s) => s.label)).toEqual(['10:00–12:00', '14:00–16:00']);
        expect(days[6].slots).toEqual([]); // Sunday
        expect(days[1].slots[0].id).toBe(`${morning._id}_2026-10-20`);
    });

    it('applies closed dates for the module, zone or everywhere', async () => {
        await SlotBlackout.create({ date: '2026-10-20', reason: 'Diwali' });
        await SlotBlackout.create({ date: '2026-10-21', module: 'laundry' });
        await SlotBlackout.create({ date: '2026-10-22', zone: zone._id, module: 'grocery' });
        const days = await generateSlots({ ...ctx, zoneId: zone._id, days: 4 });
        expect(days.map((d) => d.closed)).toEqual([null, 'Diwali', null, 'Closed']);
    });

    it('uses zone-specific rules instead of the global ones', async () => {
        await SlotRule.create({ module: 'grocery', kind: 'delivery', zone: zone._id, daysOfWeek: [2], start: '18:00', end: '20:00', capacity: 5 });
        const here = await generateSlots({ ...ctx, zoneId: zone._id, days: 2 });
        expect(here[1].slots.map((s) => s.label)).toEqual(['18:00–20:00']);
        const elsewhere = await generateSlots({ ...ctx, zoneId: null, days: 2 });
        expect(elsewhere[1].slots).toHaveLength(2);
    });
});

describe('reserving slots', () => {
    const tuesdayMorning = () => `${morning._id}_2026-10-20`;

    it('enforces capacity, also under concurrent requests', async () => {
        const results = await Promise.allSettled(
            Array.from({ length: 5 }, () => reserveSlot(tuesdayMorning(), { ...ctx, zoneId: zone._id }))
        );
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
        expect(results.find((r) => r.status === 'rejected').reason.message).toMatch(/filled up/);

        const [, tue] = await generateSlots({ ...ctx, zoneId: zone._id, days: 2 });
        expect(tue.slots[0].available).toBe(false);

        await releaseSlot(tuesdayMorning());
        await expect(reserveSlot(tuesdayMorning(), { ...ctx, zoneId: zone._id })).resolves.toMatchObject({ label: '10:00–12:00' });
    });

    it('rejects slots past cutoff, on the wrong weekday, closed, or for another module', async () => {
        await expect(resolveSlot(`${morning._id}_2026-10-19`, { ...ctx, zoneId: zone._id })).rejects.toThrow(/closed/);
        await expect(resolveSlot(`${morning._id}_2026-10-25`, { ...ctx, zoneId: zone._id })).rejects.toThrow(/does not run/);
        await SlotBlackout.create({ date: '2026-10-20' });
        await expect(resolveSlot(tuesdayMorning(), { ...ctx, zoneId: zone._id })).rejects.toThrow(/closed on that date/);
        await expect(resolveSlot(`${afternoon._id}_2026-10-21`, { ...ctx, module: 'laundry', kind: 'pickup', zoneId: zone._id })).rejects.toThrow(/not available/);
        await expect(resolveSlot('garbage', ctx)).rejects.toThrow(/Invalid slot/);
    });
});

describe('slot API', () => {
    it('serves slots for a serviceable location and 404s outside', async () => {
        const res = await api().get('/api/v1/slots?module=grocery&pincode=411038&days=2');
        expect(res.status).toBe(200);
        expect(res.body.data.zone.name).toBe('Kothrud');
        expect(res.body.data.days).toHaveLength(2);

        expect((await api().get('/api/v1/slots?module=grocery&pincode=400001')).status).toBe(404);
        expect((await api().get('/api/v1/slots?module=grocery')).status).toBe(400);
    });

    it('lets admins manage rules and closed dates, and scopes ops users', async () => {
        const { token } = await loginStaff(await createStaff());
        const admin = { Authorization: `Bearer ${token}` };
        const bad = await api().post('/api/v1/admin/slots/rules').set(admin)
            .send({ module: 'laundry', kind: 'pickup', daysOfWeek: [1], start: '12:00', end: '09:00', capacity: 5 });
        expect(bad.status).toBe(400);
        const good = await api().post('/api/v1/admin/slots/rules').set(admin)
            .send({ module: 'laundry', kind: 'pickup', daysOfWeek: [1, 1, 3], start: '09:00', end: '12:00', capacity: 5 });
        expect(good.status).toBe(201);
        expect(good.body.data.daysOfWeek).toEqual([1, 3]);

        expect((await api().post('/api/v1/admin/slots/blackouts').set(admin).send({ date: '2026-02-30' })).status).toBe(400);
        expect((await api().post('/api/v1/admin/slots/blackouts').set(admin).send({ date: '2026-11-08', reason: 'Diwali' })).status).toBe(201);

        const ops = await createStaff({ role: 'ops', isSuperAdmin: false, modules: ['laundry'], permissions: { zones: ['view', 'create', 'update'] } });
        const opsAuth = { Authorization: `Bearer ${(await loginStaff(ops)).token}` };
        const rules = await api().get('/api/v1/admin/slots/rules').set(opsAuth);
        expect(rules.body.data.map((r) => r.module)).toEqual(['laundry']);
        const foreign = await api().patch(`/api/v1/admin/slots/rules/${morning._id}`).set(opsAuth).send({ capacity: 99 });
        expect(foreign.status).toBe(403);
        const blackout = await api().post('/api/v1/admin/slots/blackouts').set(opsAuth).send({ date: '2026-11-09' });
        expect(blackout.status).toBe(403);
    });
});
