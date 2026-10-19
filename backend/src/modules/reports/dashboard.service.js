import { addDays, istDate, istInstant } from '../../lib/istTime.js';
import { Product } from '../catalog/product.model.js';
import { LaundryBooking } from '../laundry/booking.model.js';
import { Order } from '../orders/order.model.js';
import { BUSINESS_MODULES } from '../staff/permissions.js';
import { User } from '../users/user.model.js';

const OPEN = ['placed', 'accepted', 'packing', 'ready', 'dispatched'];
const NOT_COUNTED = ['pending_payment', 'cancelled'];

/**
 * Headline numbers for the panel home (scope §7: "high-level counts and
 * summaries for orders, customers, catalogue items and category activity").
 * Days are IST calendar days. `modules` limits it for ops users.
 */
export const getDashboard = async ({ modules = null } = {}) => {
    const scope = modules ?? BUSINESS_MODULES;
    const productScope = scope.filter((m) => m !== 'laundry');
    const today = istDate();
    const weekFrom = addDays(today, -6);
    const weekStart = istInstant(weekFrom, '00:00');
    const showLaundry = scope.includes('laundry');

    const istDay = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } };

    const [weekOrders, openOrders, catalogue, lowStock, customers, newCustomers, bookingWeek, bookingOpen] = await Promise.all([
        Order.aggregate([
            { $match: { module: { $in: productScope }, createdAt: { $gte: weekStart }, status: { $nin: NOT_COUNTED } } },
            { $group: { _id: { day: istDay, module: '$module' }, orders: { $sum: 1 }, revenuePaise: { $sum: '$pricing.totalPaise' } } }
        ]),
        Order.aggregate([
            { $match: { module: { $in: productScope }, status: { $in: OPEN } } },
            { $group: { _id: '$status', n: { $sum: 1 } } }
        ]),
        Product.aggregate([
            { $match: { module: { $in: productScope } } },
            { $group: { _id: '$module', products: { $sum: 1 }, active: { $sum: { $cond: ['$isActive', 1, 0] } }, outOfStock: { $sum: { $cond: [{ $and: ['$isActive', { $not: ['$inStock'] }] }, 1, 0] } } } }
        ]),
        Product.aggregate([
            { $match: { module: { $in: productScope }, isActive: true } },
            { $unwind: '$variants' },
            { $match: { 'variants.isActive': true, $expr: { $lte: ['$variants.stockQty', '$variants.lowStockThreshold'] } } },
            { $count: 'n' }
        ]),
        User.countDocuments(),
        User.countDocuments({ createdAt: { $gte: weekStart } }),
        showLaundry
            ? LaundryBooking.aggregate([
                { $match: { createdAt: { $gte: weekStart }, status: { $nin: NOT_COUNTED } } },
                { $group: { _id: istDay, bookings: { $sum: 1 }, revenuePaise: { $sum: '$pricing.totalPaise' } } }
            ])
            : [],
        showLaundry
            ? LaundryBooking.aggregate([
                { $match: { status: { $nin: ['completed', 'cancelled', 'pending_payment'] } } },
                { $group: { _id: '$status', n: { $sum: 1 } } }
            ])
            : []
    ]);

    // Seven IST days, oldest first, zero-filled.
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekFrom, i));
    const daily = days.map((date) => {
        const rows = weekOrders.filter((r) => r._id.day === date);
        const booking = bookingWeek.find((r) => r._id === date);
        return {
            date,
            orders: rows.reduce((n, r) => n + r.orders, 0) + (booking?.bookings ?? 0),
            revenuePaise: rows.reduce((n, r) => n + r.revenuePaise, 0) + (booking?.revenuePaise ?? 0)
        };
    });

    const byModule = scope.map((module) => {
        if (module === 'laundry') {
            return { module, orders: bookingWeek.reduce((n, r) => n + r.bookings, 0), revenuePaise: bookingWeek.reduce((n, r) => n + r.revenuePaise, 0) };
        }
        const rows = weekOrders.filter((r) => r._id.module === module);
        return { module, orders: rows.reduce((n, r) => n + r.orders, 0), revenuePaise: rows.reduce((n, r) => n + r.revenuePaise, 0) };
    });

    const todayRow = daily.at(-1);
    const openCounts = Object.fromEntries(openOrders.map((r) => [r._id, r.n]));
    const bookingCounts = Object.fromEntries(bookingOpen.map((r) => [r._id, r.n]));

    return {
        today: { date: today, orders: todayRow.orders, revenuePaise: todayRow.revenuePaise },
        week: { orders: daily.reduce((n, d) => n + d.orders, 0), revenuePaise: daily.reduce((n, d) => n + d.revenuePaise, 0), daily, byModule },
        openOrders: { total: Object.values(openCounts).reduce((a, b) => a + b, 0), byStatus: openCounts, needsAction: openCounts.placed ?? 0 },
        bookings: showLaundry
            ? { open: Object.values(bookingCounts).reduce((a, b) => a + b, 0), byStatus: bookingCounts, toWeigh: bookingCounts.picked_up ?? 0, newRequests: bookingCounts.placed ?? 0 }
            : null,
        catalogue: {
            byModule: productScope.map((module) => {
                const row = catalogue.find((c) => c._id === module);
                return { module, products: row?.products ?? 0, active: row?.active ?? 0, outOfStock: row?.outOfStock ?? 0 };
            }),
            lowStockVariants: lowStock[0]?.n ?? 0
        },
        customers: { total: customers, newThisWeek: newCustomers },
        generatedAt: new Date()
    };
};
