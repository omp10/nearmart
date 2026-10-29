import mongoose from 'mongoose';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { escapeRegex } from '../../lib/pagination.js';
import { addDays, istDate, weekday } from '../../lib/istTime.js';
import { Category } from '../catalog/category.model.js';
import { PRODUCT_MODULES } from '../catalog/module.model.js';
import { Product } from '../catalog/product.model.js';
import { notify, notifyStaff } from '../notifications/notification.service.js';
import { deleteDocument } from './documents.js';
import { MarketplaceConfig, Seller } from './seller.model.js';

// ─── Marketplace settings ───

export const DEFAULT_COMMISSION = Object.freeze({ percent: 10, fixedFeePaise: 0 });

export const getConfig = async () => {
    const doc = await MarketplaceConfig.findOneAndUpdate({ key: 'marketplace' }, { $setOnInsert: { key: 'marketplace' } }, { upsert: true, new: true }).lean();
    const commission = Object.fromEntries(PRODUCT_MODULES.map((m) => [m, { ...DEFAULT_COMMISSION, ...(doc.commission?.[m] ?? {}) }]));
    return { commission, payoutHoldDays: doc.payoutHoldDays ?? 3, acceptAlertMinutes: doc.acceptAlertMinutes ?? 10, reviewNewProducts: Boolean(doc.reviewNewProducts) };
};

export const updateConfig = async ({ commission, payoutHoldDays, acceptAlertMinutes, reviewNewProducts }) => {
    const set = {};
    for (const [module, value] of Object.entries(commission ?? {})) {
        if (value.percent != null) set[`commission.${module}.percent`] = value.percent;
        if (value.fixedFeePaise != null) set[`commission.${module}.fixedFeePaise`] = value.fixedFeePaise;
    }
    if (payoutHoldDays != null) set.payoutHoldDays = payoutHoldDays;
    if (acceptAlertMinutes != null) set.acceptAlertMinutes = acceptAlertMinutes;
    if (reviewNewProducts != null) set.reviewNewProducts = reviewNewProducts;
    await MarketplaceConfig.updateOne({ key: 'marketplace' }, { $set: set }, { upsert: true });
    return getConfig();
};

/**
 * The rate a seller pays on one module's orders: their override for that
 * shop, else their seller-wide override, else the shop's default.
 */
export const commissionFor = (seller, module, config) => {
    const byModule = seller.commission?.byModule;
    const own = (byModule instanceof Map ? byModule.get(module) : byModule?.[module]) ?? {};
    return {
        percent: own.percent ?? seller.commission?.percent ?? config.commission[module]?.percent ?? DEFAULT_COMMISSION.percent,
        fixedFeePaise: own.fixedFeePaise ?? seller.commission?.fixedFeePaise ?? config.commission[module]?.fixedFeePaise ?? DEFAULT_COMMISSION.fixedFeePaise
    };
};

// ─── Opening hours ───

const minutesOf = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

/** Whether the seller's weekly hours and holidays have the store open at `now` (no hours set = always). */
export const withinHours = (seller, now = new Date()) => {
    const today = istDate(now);
    if ((seller.holidays ?? []).includes(today)) return false;
    if (!seller.hours?.length) return true;
    const ist = new Date(now.getTime() + 330 * 60_000);
    const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const todayDay = weekday(today);
    const yesterday = addDays(today, -1);
    const yesterdayDay = weekday(yesterday);
    return seller.hours.some((h) => {
        const open = minutesOf(h.open);
        const close = minutesOf(h.close);
        // Same open and close: open all day.
        if (open === close) return h.day === todayDay;
        if (close > open) return h.day === todayDay && minute >= open && minute < close;
        // Past midnight (e.g. 18:00–02:00): the evening part belongs to the day it opens,
        // the early-morning part to that day too, unless that day was a holiday.
        if (h.day === todayDay && minute >= open) return true;
        return h.day === yesterdayDay && minute < close && !(seller.holidays ?? []).includes(yesterday);
    });
};

/** Open for orders right now: approved, login on, the manual switch on, and inside its hours. */
export const isTrading = (seller, now = new Date()) =>
    seller.status === 'approved' && seller.isActive && seller.isOpen && withinHours(seller, now);

// ─── Shapes ───

/** Everything the seller dashboard shows about the seller's own account. */
export const sellerProfile = (s) => {
    const doc = typeof s.toObject === 'function' ? s.toObject() : s;
    const { password, failedLogins, lockedUntil, tokenVersion, __v, ...rest } = doc;
    return { ...rest, id: String(doc._id), tradingNow: isTrading(doc) };
};

const findSeller = async (id) => {
    if (!mongoose.isValidObjectId(id)) throw new NotFoundError('Seller not found');
    const seller = await Seller.findById(id);
    if (!seller) throw new NotFoundError('Seller not found');
    return seller;
};

const alertSeller = (seller, title, body, type, data = {}) =>
    notify({ ownerKind: 'seller', ownerId: seller._id }, { title, body, type, data }).catch((err) => logger.warn({ err: err.message }, 'Seller notification failed'));

const alertAdmins = (title, body, type, sellerId) =>
    notifyStaff({ module: null, section: 'sellers' }, { title, body, type, data: { sellerId: String(sellerId) } });

// ─── Visibility ───

/**
 * Products of a seller are shown only while the seller is approved, active
 * and open, and only in the modules approved for them. Kept as a flag on the
 * products so catalogue queries stay simple.
 */
export const syncVisibility = async (sellerOrId) => {
    const seller = sellerOrId instanceof Seller ? sellerOrId : await Seller.findById(sellerOrId);
    if (!seller) return;
    const live = isTrading(seller);
    const modules = live ? seller.approvedModules() : [];
    const zones = seller.zones ?? [];
    await Product.updateMany({ seller: seller._id, module: { $nin: modules } }, { $set: { sellerHidden: true, sellerZones: zones } });
    if (modules.length) {
        await Product.updateMany({ seller: seller._id, module: { $in: modules } }, { $set: { sellerHidden: false, sellerName: seller.businessName, sellerZones: zones } });
    }
};

/**
 * Opens and closes stores on their schedule. Runs every minute; only stores
 * whose hours just flipped are touched.
 */
export const refreshSchedules = async (now = new Date()) => {
    const sellers = await Seller.find({ status: 'approved', $or: [{ 'hours.0': { $exists: true } }, { 'holidays.0': { $exists: true } }, { scheduleOpen: false }] });
    let changed = 0;
    for (const seller of sellers) {
        const open = withinHours(seller, now);
        if (open === seller.scheduleOpen) continue;
        seller.scheduleOpen = open;
        await seller.save();
        await syncVisibility(seller);
        changed += 1;
    }
    return changed;
};

/** Seller sets their weekly hours and holidays. */
export const setHours = async (sellerId, { hours, holidays }) => {
    const seller = await findSeller(sellerId);
    if (hours) seller.hours = hours;
    if (holidays) seller.holidays = [...new Set(holidays)].sort();
    seller.scheduleOpen = withinHours(seller);
    await seller.save();
    await syncVisibility(seller);
    return sellerProfile(seller);
};

// ─── KYC formats ───

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const FSSAI = /^[0-9]{14}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** GSTIN check character (mod-36 Luhn variant used by GSTN). */
const gstinChecksumOk = (gstin) => {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let sum = 0;
    for (let i = 0; i < 14; i += 1) {
        const product = chars.indexOf(gstin[i]) * (i % 2 === 0 ? 1 : 2);
        sum += Math.floor(product / 36) + (product % 36);
    }
    return chars[(36 - (sum % 36)) % 36] === gstin[14];
};

/** Format problems in the tax and bank details, as field → message. */
export const kycProblems = ({ legal = {}, bank = {} } = {}) => {
    const out = {};
    const pan = (legal.pan ?? '').toUpperCase();
    const gstin = (legal.gstin ?? '').toUpperCase();
    if (pan && !PAN.test(pan)) out['legal.pan'] = 'PAN looks wrong: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)';
    if (gstin) {
        if (!GSTIN.test(gstin) || !gstinChecksumOk(gstin)) out['legal.gstin'] = 'GSTIN looks wrong: check all 15 characters';
        else if (pan && gstin.slice(2, 12) !== pan) out['legal.gstin'] = "GSTIN doesn't match the PAN";
    }
    if (legal.fssai && !FSSAI.test(legal.fssai)) out['legal.fssai'] = 'FSSAI licence numbers are 14 digits';
    if (bank.ifsc && !IFSC.test(String(bank.ifsc).toUpperCase())) out['bank.ifsc'] = 'IFSC looks wrong (e.g. HDFC0001234)';
    return out;
};

const assertKyc = (seller) => {
    const problems = kycProblems({ legal: seller.legal, bank: seller.bank });
    const entries = Object.entries(problems);
    if (entries.length) throw new AppError(entries[0][1], 400, entries.map(([path, message]) => ({ path, message })));
};

/** Where riders collect a seller's orders. */
export const sellerPlace = async (sellerId) => {
    const s = await Seller.findById(sellerId).select('businessName phone store address').lean();
    if (!s) return null;
    const a = s.address ?? {};
    return {
        name: s.businessName,
        phone: s.store?.supportPhone || s.phone,
        address: [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', '),
        landmark: a.landmark ?? '',
        lat: a.lat ?? null,
        lng: a.lng ?? null
    };
};

// ─── Seller side ───

const EDITABLE_BEFORE_APPROVAL = ['draft', 'rejected'];

export const getSellerMe = async (sellerId) => sellerProfile(await findSeller(sellerId));

/**
 * Saves the application form. Before approval every section can change; after
 * it the business identity (name, legal numbers) is fixed, since the admin
 * checked it, but store details, address and bank details stay editable.
 */
export const updateApplication = async (sellerId, input) => {
    const seller = await findSeller(sellerId);
    const open = EDITABLE_BEFORE_APPROVAL.includes(seller.status);
    if (seller.status === 'submitted') throw new ConflictError('Your application is being reviewed. You can edit it once it is approved or returned.');

    const { businessName, ownerName, legal, store, address, bank, modules } = input;
    if (!open && (businessName || legal)) throw new ValidationError('Business name and tax details can only be changed by Nearmart support after approval');
    if (businessName) seller.businessName = businessName;
    if (ownerName) seller.ownerName = ownerName;
    if (legal) {
        const clean = Object.fromEntries(Object.entries(legal).map(([k, v]) => [k, typeof v === 'string' ? v.trim().toUpperCase() : v]));
        seller.legal = { ...seller.legal?.toObject?.(), ...clean };
    }
    if (store) seller.store = { ...seller.store?.toObject?.(), ...store };
    if (address) seller.address = { ...seller.address?.toObject?.(), ...address };
    if (bank) seller.bank = { ...seller.bank?.toObject?.(), ...bank };
    if (modules) {
        if (!open) throw new ValidationError('Use "Sell in another shop" to add a shop after approval');
        seller.modules = await checkedModules(modules);
    }
    if (legal || bank) assertKyc(seller);
    await seller.save();
    if (!open && bank) alertAdmins(`${seller.businessName} changed bank details`, 'Check them before the next payout.', 'staff.seller.bank_changed', seller._id);
    if (!open) await syncVisibility(seller);
    return sellerProfile(seller);
};

/** Validates requested modules and categories (top-level categories of that module). */
const checkedModules = async (modules) => {
    const seen = new Set();
    const out = [];
    for (const m of modules) {
        if (seen.has(m.key)) continue;
        seen.add(m.key);
        const categories = [...new Set((m.categories ?? []).map(String))];
        if (categories.length) {
            const found = await Category.countDocuments({ _id: { $in: categories }, module: m.key });
            if (found !== categories.length) throw new ValidationError(`Some categories don't belong to ${m.key}`);
        }
        out.push({ key: m.key, categories, status: 'pending', requestedAt: new Date() });
    }
    return out;
};

const missingForSubmit = (s) => {
    const missing = [];
    if (!s.address?.line1 || !s.address?.city || !s.address?.pincode) missing.push('shop address');
    if (!s.modules.length) missing.push('at least one category to sell in');
    if (!s.legal?.pan) missing.push('PAN');
    if (!(s.bank?.accountNumber && s.bank?.ifsc) && !s.bank?.upiId) missing.push('bank account or UPI ID');
    if (!s.documents.length) missing.push('at least one document');
    return missing;
};

export const submitApplication = async (sellerId) => {
    const seller = await findSeller(sellerId);
    if (!EDITABLE_BEFORE_APPROVAL.includes(seller.status)) throw new ConflictError('This application has already been submitted');
    const missing = missingForSubmit(seller);
    if (missing.length) throw new ValidationError(`Please add: ${missing.join(', ')}`);
    assertKyc(seller);
    seller.status = 'submitted';
    seller.submittedAt = new Date();
    seller.rejectionReason = '';
    seller.modules.forEach((m) => { if (m.status === 'rejected') m.status = 'pending'; });
    seller.statusHistory.push({ status: 'submitted', by: { kind: 'seller', id: seller._id } });
    await seller.save();
    alertAdmins(`New seller application: ${seller.businessName}`, `${seller.ownerName} · ${seller.modules.map((m) => m.key).join(', ')}`, 'staff.seller.submitted', seller._id);
    return sellerProfile(seller);
};

/** An approved seller asks to sell in another shop (or to retry one that was turned down). */
export const requestModule = async (sellerId, { key, categories = [] }) => {
    const seller = await findSeller(sellerId);
    if (!['approved', 'suspended'].includes(seller.status)) throw new ConflictError('Add categories in your application before it is approved');
    const [entry] = await checkedModules([{ key, categories }]);
    const current = seller.modules.find((m) => m.key === key);
    if (current?.status === 'approved') throw new ConflictError('You already sell in this shop');
    if (current?.status === 'pending') throw new ConflictError('This request is already waiting for approval');
    if (current) Object.assign(current, entry);
    else seller.modules.push(entry);
    await seller.save();
    alertAdmins(`${seller.businessName} wants to sell in ${key}`, 'Approve or reject it on the seller page.', 'staff.seller.module_request', seller._id);
    return sellerProfile(seller);
};

export const addDocument = async (sellerId, doc) => {
    const seller = await findSeller(sellerId);
    if (seller.documents.length >= 20) throw new ValidationError('At most 20 documents');
    seller.documents.push(doc);
    await seller.save();
    return sellerProfile(seller);
};

export const removeDocument = async (sellerId, docId) => {
    const seller = await findSeller(sellerId);
    if (!EDITABLE_BEFORE_APPROVAL.includes(seller.status)) throw new ConflictError('Documents can only be removed before the application is submitted');
    const doc = seller.documents.id(docId);
    if (!doc) throw new NotFoundError('Document not found');
    doc.deleteOne();
    await seller.save();
    await deleteDocument(doc.file);
    return sellerProfile(seller);
};

export const setOpen = async (sellerId, isOpen) => {
    const seller = await findSeller(sellerId);
    if (seller.status !== 'approved') throw new ConflictError('Your store opens once Nearmart approves it');
    seller.isOpen = isOpen;
    await seller.save();
    await syncVisibility(seller);
    return sellerProfile(seller);
};

// ─── Admin side ───

export const listSellers = async ({ status, q, page, limit }) => {
    const filter = {};
    if (status) filter.status = status;
    if (q) {
        const rx = new RegExp(escapeRegex(q.trim()), 'i');
        filter.$or = [{ businessName: rx }, { ownerName: rx }, { phone: rx }, { email: rx }];
    }
    const [items, total, counts] = await Promise.all([
        Seller.find(filter)
            .select('businessName ownerName phone email status modules.key modules.status address.city isOpen isActive commission submittedAt createdAt store.logo')
            .sort({ submittedAt: -1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        Seller.countDocuments(filter),
        Seller.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }])
    ]);
    const pendingModules = await Seller.countDocuments({ status: 'approved', 'modules.status': 'pending' });
    return {
        items,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        counts: { ...Object.fromEntries(counts.map((c) => [c._id, c.n])), moduleRequests: pendingModules }
    };
};

export const getSellerAdmin = async (sellerId) => {
    const seller = await Seller.findById(sellerId).populate('modules.categories', 'name').populate('zones', 'name').lean();
    if (!seller) throw new NotFoundError('Seller not found');
    const productCount = await Product.countDocuments({ seller: seller._id });
    const { password, ...rest } = seller;
    return { ...rest, productCount, kycWarnings: kycProblems(seller), tradingNow: isTrading(seller), effectiveCommission: Object.fromEntries((await Promise.all(seller.modules.map(async (m) => [m.key, commissionFor(seller, m.key, await getConfig())])))) };
};

const record = (seller, status, by, note = '') => seller.statusHistory.push({ status, by: { kind: 'staff', id: by }, note });

/**
 * Approves an application. `modules` picks which requested shops to approve
 * (default: all still pending); any others stay pending for later.
 */
export const approveSeller = async (sellerId, { modules, commissionPercent, fixedFeePaise, note = '' }, by) => {
    const seller = await findSeller(sellerId);
    if (!['submitted', 'rejected', 'suspended'].includes(seller.status)) throw new ConflictError(`A ${seller.status} seller can't be approved`);
    const keys = modules ?? seller.modules.filter((m) => m.status !== 'rejected').map((m) => m.key);
    if (!keys.length && !seller.approvedModules().length) throw new ValidationError('Approve at least one shop for this seller');
    for (const m of seller.modules) {
        if (keys.includes(m.key)) {
            m.status = 'approved';
            m.decidedAt = new Date();
        }
    }
    if (commissionPercent !== undefined) seller.commission.percent = commissionPercent;
    if (fixedFeePaise !== undefined) seller.commission.fixedFeePaise = fixedFeePaise;
    seller.status = 'approved';
    seller.rejectionReason = '';
    seller.reviewedAt = new Date();
    record(seller, 'approved', by, note);
    await seller.save();
    await syncVisibility(seller);
    alertSeller(seller, 'Your store is approved 🎉', 'You can now add products and start receiving orders on Nearmart.', 'seller.approved');
    return getSellerAdmin(seller._id);
};

export const rejectSeller = async (sellerId, { reason }, by) => {
    const seller = await findSeller(sellerId);
    if (seller.status !== 'submitted') throw new ConflictError('Only a submitted application can be rejected');
    seller.status = 'rejected';
    seller.rejectionReason = reason;
    seller.reviewedAt = new Date();
    record(seller, 'rejected', by, reason);
    await seller.save();
    alertSeller(seller, 'Your application needs changes', reason, 'seller.rejected');
    return getSellerAdmin(seller._id);
};

export const suspendSeller = async (sellerId, { reason }, by) => {
    const seller = await findSeller(sellerId);
    if (seller.status !== 'approved') throw new ConflictError('Only an approved seller can be suspended');
    seller.status = 'suspended';
    seller.rejectionReason = reason;
    record(seller, 'suspended', by, reason);
    await seller.save();
    await syncVisibility(seller);
    alertSeller(seller, 'Your store has been paused', reason, 'seller.suspended');
    return getSellerAdmin(seller._id);
};

/** Approves or rejects one shop request of an already approved seller. */
export const decideModule = async (sellerId, key, { approve, note = '' }, by) => {
    const seller = await findSeller(sellerId);
    const entry = seller.modules.find((m) => m.key === key);
    if (!entry) throw new NotFoundError('This seller has not asked to sell in that shop');
    entry.status = approve ? 'approved' : 'rejected';
    entry.note = note;
    entry.decidedAt = new Date();
    record(seller, seller.status, by, `${key} ${approve ? 'approved' : 'rejected'}${note ? `: ${note}` : ''}`);
    await seller.save();
    await syncVisibility(seller);
    alertSeller(seller, approve ? `You can now sell in ${key}` : `Request to sell in ${key} declined`, note || (approve ? 'Add your products from the dashboard.' : ''), 'seller.module');
    return getSellerAdmin(seller._id);
};

/** Admin edits: commission override, service areas, login switch. */
export const updateSellerAdmin = async (sellerId, { commission, zones, isActive }) => {
    const seller = await findSeller(sellerId);
    if (commission) {
        if (commission.percent !== undefined) seller.commission.percent = commission.percent;
        if (commission.fixedFeePaise !== undefined) seller.commission.fixedFeePaise = commission.fixedFeePaise;
        for (const [module, value] of Object.entries(commission.byModule ?? {})) {
            // Both null clears that shop's override.
            if (value.percent == null && value.fixedFeePaise == null) seller.commission.byModule.delete(module);
            else seller.commission.byModule.set(module, { percent: value.percent ?? null, fixedFeePaise: value.fixedFeePaise ?? null });
        }
    }
    if (zones) seller.zones = zones;
    if (isActive !== undefined) {
        seller.isActive = isActive;
        if (!isActive) seller.tokenVersion += 1; // signs them out everywhere
    }
    await seller.save();
    await syncVisibility(seller);
    return getSellerAdmin(seller._id);
};
