import mongoose from 'mongoose';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { addDays, istDate, istInstant, weekday } from '../../lib/istTime.js';
import { SlotBlackout, SlotReservation, SlotRule } from './slot.model.js';

/** Customers can book at most this far ahead. */
export const MAX_DAYS_AHEAD = 14;

const toId = (v) => (v ? new mongoose.Types.ObjectId(String(v)) : null);

/** Slot ids are "<ruleId>_<YYYY-MM-DD>": stable, and enough to re-check a choice at checkout. */
export const slotId = (ruleId, date) => `${ruleId}_${date}`;
const parseSlotId = (id) => {
    const match = /^([a-f0-9]{24})_(\d{4}-\d{2}-\d{2})$/i.exec(String(id || ''));
    if (!match) throw new ValidationError('Invalid slot');
    return { ruleId: match[1], date: match[2] };
};

/** Zone-specific rules replace the global ones for that zone. */
const applicableRules = async ({ module, kind, zoneId }) => {
    const rules = await SlotRule.find({ module, kind, isActive: true, zone: { $in: zoneId ? [null, toId(zoneId)] : [null] } })
        .sort({ start: 1 })
        .lean();
    const zoneRules = zoneId ? rules.filter((r) => String(r.zone) === String(zoneId)) : [];
    return zoneRules.length ? zoneRules : rules.filter((r) => r.zone == null);
};

const blackoutsFor = async ({ module, zoneId, from, to }) => {
    const rows = await SlotBlackout.find({
        date: { $gte: from, $lte: to },
        module: { $in: [null, module] },
        zone: { $in: zoneId ? [null, toId(zoneId)] : [null] }
    }).lean();
    return new Map(rows.map((b) => [b.date, b.reason || 'Closed']));
};

const describe = (rule, date) => ({
    id: slotId(rule._id, date),
    date,
    start: istInstant(date, rule.start),
    end: istInstant(date, rule.end),
    label: `${rule.start}–${rule.end}`
});

/**
 * Upcoming slots, grouped by IST date. Slots past their cutoff are left out;
 * full ones are listed with `available: false` so the app can show them greyed.
 */
export const generateSlots = async ({ module, kind, zoneId, days = 3, now = new Date(), includeCounts = false }) => {
    const from = istDate(now);
    const to = addDays(from, Math.min(Math.max(days, 1), MAX_DAYS_AHEAD) - 1);
    const rules = await applicableRules({ module, kind, zoneId });
    const [closed, reservations] = await Promise.all([
        blackoutsFor({ module, zoneId, from, to }),
        SlotReservation.find({ rule: { $in: rules.map((r) => r._id) }, date: { $gte: from, $lte: to } }).lean()
    ]);
    const booked = new Map(reservations.map((r) => [slotId(r.rule, r.date), r.count]));

    const result = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
        if (closed.has(date)) {
            result.push({ date, closed: closed.get(date), slots: [] });
            continue;
        }
        const slots = rules
            .filter((rule) => rule.daysOfWeek.includes(weekday(date)))
            .map((rule) => {
                const slot = describe(rule, date);
                const count = booked.get(slot.id) ?? 0;
                const orderBy = new Date(slot.start.getTime() - rule.cutoffMinutes * 60_000);
                return {
                    ...slot,
                    orderBy,
                    available: now < orderBy && count < rule.capacity,
                    ...(includeCounts ? { booked: count, capacity: rule.capacity, ruleId: String(rule._id) } : {})
                };
            })
            .filter((s) => includeCounts || now < s.orderBy);
        result.push({ date, closed: null, slots });
    }
    return result;
};

/**
 * Re-checks a slot the customer picked: right module/kind/zone, a matching
 * weekday, not closed, not past cutoff. Throws a 400 explaining what's wrong.
 */
export const resolveSlot = async (id, { module, kind, zoneId, now = new Date() }) => {
    const { ruleId, date } = parseSlotId(id);
    const rules = await applicableRules({ module, kind, zoneId });
    const rule = rules.find((r) => String(r._id) === ruleId);
    if (!rule) throw new ValidationError('That slot is not available for this address');
    if (!rule.daysOfWeek.includes(weekday(date))) throw new ValidationError('That slot does not run on this date');
    if (date > addDays(istDate(now), MAX_DAYS_AHEAD - 1)) throw new ValidationError('That date is too far ahead');
    if ((await blackoutsFor({ module, zoneId, from: date, to: date })).size) throw new ValidationError('We are closed on that date');

    const slot = describe(rule, date);
    if (now >= new Date(slot.start.getTime() - rule.cutoffMinutes * 60_000)) {
        throw new ValidationError('That slot has closed. Please choose another.');
    }
    return { ...slot, rule };
};

/**
 * Takes one place in a slot. The counter only increments while below
 * capacity; when the slot is full the conditional upsert collides with the
 * existing row and is reported as full, so capacity can't be overshot.
 */
export const reserveSlot = async (id, context) => {
    const slot = await resolveSlot(id, context);
    const { rule } = slot;
    const filter = { rule: rule._id, date: slot.date, count: { $lt: rule.capacity } };
    try {
        await SlotReservation.updateOne(filter, { $inc: { count: 1 } }, { upsert: true });
    } catch (err) {
        if (err?.code !== 11000) throw err;
        // Either the slot is full, or another request created the counter row
        // at the same moment. Try once more as a plain conditional increment.
        const retry = await SlotReservation.updateOne(filter, { $inc: { count: 1 } });
        if (retry.modifiedCount === 0) throw new ValidationError('That slot just filled up. Please choose another.');
    }
    const { rule: _omit, ...publicSlot } = slot;
    return publicSlot;
};

/** Gives a place back (order cancelled or slot changed). */
export const releaseSlot = async (id) => {
    const { ruleId, date } = parseSlotId(id);
    await SlotReservation.updateOne({ rule: toId(ruleId), date, count: { $gt: 0 } }, { $inc: { count: -1 } });
};

// ─── Admin ───

export const listRules = (filter) => SlotRule.find(filter).populate('zone', 'name').sort({ module: 1, kind: 1, start: 1 }).lean();

export const getRule = async (id) => {
    const rule = await SlotRule.findById(id);
    if (!rule) throw new NotFoundError('Slot rule not found');
    return rule;
};

export const createRule = (input) => SlotRule.create(input);

export const updateRule = async (id, input) => {
    const rule = await getRule(id);
    Object.assign(rule, input);
    return rule.save();
};

export const deleteRule = async (id) => {
    const rule = await getRule(id);
    // Booked future slots keep their reservations row; Phase 3 orders keep their own slot copy.
    await rule.deleteOne();
};
