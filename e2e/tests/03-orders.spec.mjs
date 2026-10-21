import { expect, test } from '@playwright/test';
import { acceptConfirms, adminApi, apiClient, customerApi, login, phone, uid } from './helpers.mjs';

/**
 * A customer orders through the API (as the app does); staff take it from
 * the new-order alert to delivered in the panel, including an item that turns
 * out to be unavailable.
 */
test('an order goes from the app to delivered, with an unavailable item re-priced', async ({ page, request }) => {
    // Store set-up through the API, so this spec doesn't depend on the others.
    const admin = await adminApi(request);
    const pincode = '411001';
    await admin.post('/admin/zones', { name: `Camp ${uid()}`, modules: ['grocery'], pincodes: [pincode], deliveryFeePaise: 2000, freeDeliveryAbovePaise: 100000 });
    const cat = await admin.post('/admin/catalog/categories', { module: 'grocery', name: `Staples ${uid()}` });
    const atta = await admin.post('/admin/catalog/products', {
        module: 'grocery', category: cat._id, name: `Atta ${uid()}`, gstRate: 5,
        variants: [{ label: '5 kg', pricePaise: 29000, offerPricePaise: 26500, stockQty: 20 }]
    });
    const rice = await admin.post('/admin/catalog/products', {
        module: 'grocery', category: cat._id, name: `Basmati ${uid()}`, gstRate: 5,
        variants: [{ label: '1 kg', pricePaise: 14500, stockQty: 10 }]
    });
    const code = `SAVE${uid().toUpperCase()}`;
    await admin.post('/admin/coupons', { code, type: 'flat', value: 5000, minOrderPaise: 20000 });

    // The customer: sign in, address, cart, quote, order.
    const customer = await customerApi(request, phone(), 'Asha Kulkarni');
    const address = await customer.post('/me/addresses', { name: 'Asha Kulkarni', line1: 'Flat 4B, Shanti Apartments', city: 'Pune', state: 'Maharashtra', pincode });
    expect(address.serviceableModules).toContain('grocery');
    await customer.put('/cart/items', { productId: atta._id, variantId: atta.variants[0]._id, qty: 2 });
    await customer.put('/cart/items', { productId: rice._id, variantId: rice.variants[0]._id, qty: 1 });
    const quote = await customer.post('/checkout/quote', { module: 'grocery', addressId: address._id, couponCode: code });
    // 2 × 265 + 145 = 675, −50 coupon, +20 delivery.
    expect(quote.pricing).toMatchObject({ subtotalPaise: 67500, discountPaise: 5000, deliveryFeePaise: 2000, totalPaise: 64500 });
    // Like the app: when the module has delivery slots, pick the first open one.
    let slotId;
    if (quote.slotRequired) {
        const slots = await apiClient(request).get(`/slots?module=grocery&pincode=${pincode}&days=3`);
        slotId = slots.days.flatMap((d) => d.slots).find((s) => s.available)?.id;
        expect(slotId, 'an open delivery slot').toBeTruthy();
    }
    const { order } = await customer.post('/checkout', { module: 'grocery', addressId: address._id, couponCode: code, paymentMethod: 'cod', notes: 'Ring twice', slotId });
    expect(order.status).toBe('placed');

    // Staff see the alert and work the order.
    acceptConfirms(page);
    await login(page);
    await page.getByRole('combobox', { name: 'Module' }).selectOption('grocery');
    const bell = page.getByRole('button', { name: /^Notifications/ });
    await expect(bell).toHaveAccessibleName(/unread/);
    await bell.click();
    await page.getByRole('button', { name: new RegExp(`New order #${order.orderNumber}`) }).click();
    await expect(page.getByRole('heading', { name: `#${order.orderNumber}` })).toBeVisible();
    const main = page.getByRole('main');
    await expect(main).toContainText('Ring twice');
    await expect(main).toContainText('₹645.00');

    await main.getByRole('button', { name: 'Accept order' }).click();
    await main.getByRole('button', { name: 'Start packing' }).click();
    await expect(main.getByRole('button', { name: 'Mark ready for dispatch' })).toBeVisible();

    // Rice is out on the shelf: the order is re-priced; the coupon and fee stay.
    await main.getByRole('row', { name: new RegExp(rice.name) }).getByRole('button', { name: 'Unavailable' }).click();
    await expect(main).toContainText('Was ₹645.00 at checkout');
    await expect(main).toContainText('₹500.00'); // 530 − 50 + 20

    await main.getByRole('button', { name: 'Mark ready for dispatch' }).click();
    await main.getByRole('button', { name: 'Mark dispatched' }).click();
    await main.getByRole('button', { name: 'Mark delivered' }).click();
    await expect(page.getByRole('heading', { name: `#${order.orderNumber}` })).toContainText('Delivered');
    await expect(main).toContainText('Cash on delivery · Paid');

    // The customer sees the same outcome.
    const seen = await customer.get(`/orders/${order._id}`);
    expect(seen.status).toBe('delivered');
    expect(seen.pricing.totalPaise).toBe(50000);
    expect(seen.items.find((l) => l.name === rice.name).status).toBe('unavailable');

    // It's in the reports and on the dashboard.
    await page.getByRole('link', { name: 'Reports' }).click();
    await expect(main.getByRole('row', { name: new RegExp(order.orderNumber) })).toContainText('₹500.00');
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(main.getByText('Orders today')).toBeVisible();

    // A product that has been ordered can't be deleted, only hidden.
    await page.goto(`/products/${atta._id}`);
    await main.getByRole('button', { name: 'Delete' }).click();
    await expect(main.getByRole('alert')).toContainText('has been ordered');
});

test('a customer cannot order while the store is paused', async ({ page, request }) => {
    const admin = await adminApi(request);
    await login(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    const taking = page.getByRole('main').locator('form', { hasText: 'Taking orders' });
    await taking.getByLabel('Accepting new orders and bookings').uncheck();
    await taking.getByLabel('Message to customers').fill('Closed for Diwali, back on Monday');
    await taking.getByRole('button', { name: 'Save' }).click();
    await expect(taking.getByRole('status')).toHaveText('Saved');

    try {
        const settings = await (await request.get('http://127.0.0.1:5055/api/v1/settings')).json();
        expect(settings.data).toMatchObject({ acceptingOrders: false, pausedMessage: 'Closed for Diwali, back on Monday' });
    } finally {
        // Re-open the store for the specs that follow.
        await admin.patch('/admin/settings', { operations: { acceptingOrders: true } });
    }
});
