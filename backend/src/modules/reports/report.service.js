import ExcelJS from 'exceljs';
import { ValidationError } from '../../lib/errors.js';
import { addDays, istDate, istInstant, isValidDate } from '../../lib/istTime.js';
import { Product } from '../catalog/product.model.js';
import { LaundryBooking } from '../laundry/booking.model.js';
import { Order } from '../orders/order.model.js';
import { BUSINESS_MODULES } from '../staff/permissions.js';

/** Rows returned or exported at most; narrow the dates for more. */
export const MAX_ROWS = 50_000;
const MAX_RANGE_DAYS = 366;

const istDay = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: '+05:30' } });
const istDateTime = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ') : '');
const rupees = (paise) => (paise == null ? null : Math.round(paise) / 100);

/** IST date range → instants; defaults to the last 7 days. */
export const resolveRange = ({ from, to }) => {
    const end = to ?? istDate();
    const start = from ?? addDays(end, -6);
    if (!isValidDate(start) || !isValidDate(end)) throw new ValidationError('Dates must be YYYY-MM-DD');
    if (start > end) throw new ValidationError('"From" must be on or before "to"');
    if (addDays(start, MAX_RANGE_DAYS) <= end) throw new ValidationError(`Choose at most ${MAX_RANGE_DAYS} days`);
    return { from: start, to: end, $gte: istInstant(start, '00:00'), $lt: istInstant(addDays(end, 1), '00:00') };
};

const moduleFilter = (module, scope, allowed) => {
    const list = (scope ?? BUSINESS_MODULES).filter((m) => allowed.includes(m));
    if (module) {
        if (!list.includes(module)) throw new ValidationError(`No ${module} data in this report for your account`);
        return [module];
    }
    return list;
};

const PRODUCT_MODULES = ['grocery', 'produce', 'electronics'];

/**
 * Each report: column definitions (header, type for formatting) and a
 * loader returning plain rows. Money columns carry paise; exports convert.
 */
const REPORTS = {
    orders: {
        title: 'Orders',
        columns: [
            ['orderNumber', 'Order'], ['placedAt', 'Placed (IST)', 'text'], ['module', 'Module'], ['status', 'Status'],
            ['customer', 'Customer'], ['phone', 'Phone'], ['pincode', 'Pincode'], ['slot', 'Slot'], ['items', 'Items', 'number'],
            ['subtotalPaise', 'Subtotal', 'money'], ['discountPaise', 'Discount', 'money'], ['deliveryFeePaise', 'Delivery', 'money'],
            ['totalPaise', 'Total', 'money'], ['coupon', 'Coupon'], ['paymentMethod', 'Payment'], ['paymentStatus', 'Payment status']
        ],
        load: async ({ range, modules }) => {
            const rows = await Order.find({ module: { $in: modules }, createdAt: { $gte: range.$gte, $lt: range.$lt } })
                .sort({ createdAt: 1 }).limit(MAX_ROWS).lean();
            return rows.map((o) => ({
                orderNumber: o.orderNumber,
                placedAt: istDateTime(o.createdAt),
                module: o.module,
                status: o.status,
                customer: o.address?.name ?? '',
                phone: o.customerPhone,
                pincode: o.address?.pincode ?? '',
                slot: o.slot?.date ? `${o.slot.date} ${o.slot.label}` : '',
                items: o.items.filter((l) => l.status === 'ok').reduce((n, l) => n + l.qty, 0),
                subtotalPaise: o.pricing.subtotalPaise,
                discountPaise: o.pricing.discountPaise,
                deliveryFeePaise: o.pricing.deliveryFeePaise,
                totalPaise: o.pricing.totalPaise,
                coupon: o.coupon?.code ?? '',
                paymentMethod: o.payment.method,
                paymentStatus: o.payment.status
            }));
        },
        modules: PRODUCT_MODULES
    },

    sales: {
        title: 'Sales summary',
        columns: [
            ['date', 'Date'], ['module', 'Module'], ['orders', 'Orders', 'number'], ['cancelled', 'Cancelled', 'number'],
            ['grossPaise', 'Item value', 'money'], ['discountPaise', 'Discounts', 'money'], ['deliveryFeePaise', 'Delivery fees', 'money'],
            ['netPaise', 'Net sales', 'money'], ['avgOrderPaise', 'Avg order', 'money']
        ],
        load: async ({ range, modules }) => {
            const productModules = modules.filter((m) => m !== 'laundry');
            const match = { createdAt: { $gte: range.$gte, $lt: range.$lt }, status: { $ne: 'pending_payment' } };
            const group = (moduleExpr, subtotal, discount) => ({
                $group: {
                    _id: { date: istDay('$createdAt'), module: moduleExpr },
                    orders: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] } },
                    cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
                    grossPaise: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, subtotal, 0] } },
                    discountPaise: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, discount, 0] } },
                    deliveryFeePaise: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$pricing.deliveryFeePaise', 0] } },
                    netPaise: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, '$pricing.totalPaise', 0] } }
                }
            });
            const [orders, bookings] = await Promise.all([
                productModules.length ? Order.aggregate([{ $match: { ...match, module: { $in: productModules } } }, group('$module', '$pricing.subtotalPaise', '$pricing.discountPaise')]) : [],
                modules.includes('laundry')
                    ? LaundryBooking.aggregate([{ $match: match }, group('laundry', { $ifNull: ['$pricing.finalPaise', '$pricing.estimatePaise'] }, 0)])
                    : []
            ]);
            return [...orders, ...bookings]
                .map((r) => ({ date: r._id.date, module: r._id.module, ...r, _id: undefined, avgOrderPaise: r.orders ? Math.round(r.netPaise / r.orders) : 0 }))
                .sort((a, b) => a.date.localeCompare(b.date) || a.module.localeCompare(b.module));
        },
        modules: BUSINESS_MODULES
    },

    'category-orders': {
        title: 'Orders by category',
        columns: [['module', 'Module'], ['category', 'Category'], ['orders', 'Orders', 'number'], ['units', 'Units', 'number'], ['valuePaise', 'Item value', 'money']],
        load: async ({ range, modules }) => {
            const rows = await Order.aggregate([
                { $match: { module: { $in: modules }, createdAt: { $gte: range.$gte, $lt: range.$lt }, status: { $nin: ['pending_payment', 'cancelled'] } } },
                { $unwind: '$items' },
                { $match: { 'items.status': 'ok' } },
                { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p', pipeline: [{ $project: { categoryPath: 1 } }] } },
                { $set: { topCategory: { $first: { $ifNull: [{ $first: '$p.categoryPath' }, []] } } } },
                { $group: { _id: { module: '$module', category: '$topCategory' }, orderIds: { $addToSet: '$_id' }, units: { $sum: '$items.qty' }, valuePaise: { $sum: '$items.lineTotalPaise' } } },
                { $lookup: { from: 'categories', localField: '_id.category', foreignField: '_id', as: 'c', pipeline: [{ $project: { name: 1 } }] } },
                { $project: { _id: 0, module: '$_id.module', category: { $ifNull: [{ $first: '$c.name' }, '(deleted product)'] }, orders: { $size: '$orderIds' }, units: 1, valuePaise: 1 } },
                { $sort: { module: 1, valuePaise: -1 } }
            ]);
            return rows;
        },
        modules: PRODUCT_MODULES,
        dated: true
    },

    availability: {
        title: 'Product availability',
        columns: [
            ['module', 'Module'], ['product', 'Product'], ['variant', 'Variant'], ['sku', 'SKU'], ['stock', 'Stock', 'number'],
            ['lowAt', 'Low at', 'number'], ['state', 'Availability'], ['pricePaise', 'Price', 'money'], ['listed', 'Listed']
        ],
        load: async ({ modules }) => {
            const rows = await Product.aggregate([
                { $match: { module: { $in: modules } } },
                { $unwind: '$variants' },
                { $sort: { module: 1, 'variants.stockQty': 1, name: 1 } },
                { $limit: MAX_ROWS }
            ]);
            return rows.map((p) => {
                const v = p.variants;
                const effective = v.offerPricePaise != null && v.offerPricePaise < v.pricePaise ? v.offerPricePaise : v.pricePaise;
                return {
                    module: p.module,
                    product: p.name,
                    variant: v.label,
                    sku: v.sku ?? '',
                    stock: v.stockQty,
                    lowAt: v.lowStockThreshold,
                    state: v.stockQty === 0 ? 'Out of stock' : v.stockQty <= v.lowStockThreshold ? 'Low' : 'In stock',
                    pricePaise: effective,
                    listed: p.isActive && v.isActive ? 'Yes' : 'No'
                };
            });
        },
        modules: PRODUCT_MODULES,
        dated: false
    },

    bookings: {
        title: 'Laundry bookings',
        columns: [
            ['bookingNumber', 'Booking'], ['bookedAt', 'Booked (IST)'], ['status', 'Status'], ['customer', 'Customer'], ['phone', 'Phone'],
            ['pickup', 'Pickup'], ['services', 'Services'], ['estimatePaise', 'Estimate', 'money'], ['finalPaise', 'Final', 'money'],
            ['paymentMethod', 'Payment'], ['balanceDuePaise', 'Balance due', 'money']
        ],
        load: async ({ range }) => {
            const rows = await LaundryBooking.find({ createdAt: { $gte: range.$gte, $lt: range.$lt } }).sort({ createdAt: 1 }).limit(MAX_ROWS).lean();
            return rows.map((b) => ({
                bookingNumber: b.bookingNumber,
                bookedAt: istDateTime(b.createdAt),
                status: b.status,
                customer: b.address?.name ?? '',
                phone: b.customerPhone,
                pickup: b.pickupSlot?.date ? `${b.pickupSlot.date} ${b.pickupSlot.label}` : '',
                services: b.items.map((l) => `${l.name} ${l.finalQty ?? l.estimatedQty}${l.pricingUnit === 'kg' ? 'kg' : 'pc'}`).join('; '),
                estimatePaise: b.pricing.estimatePaise + b.pricing.deliveryFeePaise,
                finalPaise: b.pricing.finalPaise,
                paymentMethod: b.payment.method,
                balanceDuePaise: b.payment.balanceDuePaise
            }));
        },
        modules: ['laundry']
    }
};

export const REPORT_TYPES = Object.freeze(Object.keys(REPORTS));

export const runReport = async (type, { from, to, module }, { allowedModules }) => {
    const report = REPORTS[type];
    const modules = moduleFilter(module, allowedModules, report.modules);
    if (!modules.length) throw new ValidationError('This report has no data you can see');
    const range = resolveRange({ from, to });
    const rows = await report.load({ range, modules });
    return {
        type,
        title: report.title,
        range: report.dated === false ? null : { from: range.from, to: range.to },
        columns: report.columns.map(([key, header, kind = 'text']) => ({ key, header, kind })),
        rows,
        truncated: rows.length >= MAX_ROWS
    };
};

/**
 * CSV for spreadsheets. Cells that start with = + - @ are prefixed with an
 * apostrophe so a customer name can't become a formula (CSV injection).
 */
export const toCsv = ({ columns, rows }) => {
    const cell = (value, kind) => {
        if (value == null) return '';
        let s = kind === 'money' ? rupees(value).toFixed(2) : String(value);
        if (kind === 'text' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    const lines = [columns.map((c) => cell(c.header, 'text')).join(',')];
    for (const row of rows) lines.push(columns.map((c) => cell(row[c.key], c.kind)).join(','));
    // BOM so Excel reads UTF-8 (₹, names in Indian scripts) correctly.
    return `﻿${lines.join('\r\n')}\r\n`;
};

export const toXlsx = async ({ title, columns, rows, range }) => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nearmart';
    const sheet = workbook.addWorksheet(title.slice(0, 31));
    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: Math.max(12, c.header.length + 4) }));
    for (const row of rows) {
        sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, c.kind === 'money' ? rupees(row[c.key]) : row[c.key] ?? ''])));
    }
    columns.forEach((c, i) => {
        if (c.kind === 'money') sheet.getColumn(i + 1).numFmt = '"₹"#,##0.00';
    });
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    if (range) sheet.headerFooter.oddHeader = `${title} ${range.from} to ${range.to}`;
    return workbook.xlsx.writeBuffer();
};
