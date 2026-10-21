import { expect, test } from '@playwright/test';
import { adminApi, apiClient, customerApi, login, phone, uid } from './helpers.mjs';

test('a laundry pickup is booked, weighed, priced and returned', async ({ page, request }) => {
    const admin = await adminApi(request);
    const pincode = '411002';
    await admin.post('/admin/zones', { name: `Laundry ${uid()}`, modules: ['laundry'], pincodes: [pincode] });
    const everyDay = [0, 1, 2, 3, 4, 5, 6];
    await admin.post('/admin/slots/rules', { module: 'laundry', kind: 'pickup', daysOfWeek: everyDay, start: '00:00', end: '23:59', capacity: 50, cutoffMinutes: 0 });
    await admin.post('/admin/slots/rules', { module: 'laundry', kind: 'return', daysOfWeek: everyDay, start: '00:00', end: '23:59', capacity: 50, cutoffMinutes: 0 });

    // The price chart is set up in the panel.
    const service = `Wash & Fold ${uid()}`;
    await login(page);
    const main = page.getByRole('main');
    await page.getByRole('link', { name: 'Laundry services' }).click();
    await main.getByRole('button', { name: 'Add service' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Name').fill(service);
    await form.getByLabel('Priced per').selectOption('kg');
    await form.getByLabel(/Rate/).fill('80');
    await form.getByLabel(/Minimum billed/).fill('3');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(main.getByRole('row', { name: new RegExp(service) })).toContainText('₹80.00 / kg');

    // The customer books a pickup in the app.
    const pub = apiClient(request);
    const chart = await pub.get('/laundry/services');
    const serviceId = chart.find((s) => s.name === service).id;
    const customer = await customerApi(request, phone(), 'Rahul Deshmukh');
    const address = await customer.post('/me/addresses', { line1: '7 Law College Road', city: 'Pune', state: 'Maharashtra', pincode });
    const quote = await customer.post('/laundry/bookings/quote', { addressId: address._id, items: [{ serviceId, estimatedQty: 2 }] });
    expect(quote.pricing.estimatePaise).toBe(24000); // billed at the 3 kg minimum
    const pickup = (await pub.get(`/slots?module=laundry&kind=pickup&pincode=${pincode}&days=3`)).days.flatMap((d) => d.slots).find((s) => s.available);
    const { booking } = await customer.post('/laundry/bookings', {
        addressId: address._id, items: [{ serviceId, estimatedQty: 4 }], pickupSlotId: pickup.id,
        instructions: 'Wash whites separately', paymentMethod: 'cod'
    });

    // Staff take it from the alert through weighing to return.
    await page.reload();
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByRole('button', { name: new RegExp(`New laundry pickup #${booking.bookingNumber}`) }).click();
    await expect(page.getByRole('heading', { name: `#${booking.bookingNumber}` })).toBeVisible();
    await expect(main).toContainText('Wash whites separately');

    await main.getByRole('button', { name: 'Confirm pickup' }).click();
    await main.getByRole('button', { name: 'Mark picked up' }).click();
    await main.getByRole('button', { name: 'Confirm weight' }).click();
    const weigh = page.getByRole('dialog');
    await weigh.getByLabel(service).fill('5.5');
    await expect(weigh).toContainText('₹440.00');
    await expect(weigh).toContainText(/Estimate was\s*₹320\.00/);
    await weigh.getByRole('button', { name: 'Confirm and notify customer' }).click();
    await expect(main).toContainText('To collect at return: ₹440.00');

    await main.getByRole('button', { name: 'Schedule return' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /00:00–23:59/ }).first().click();
    await expect(main).toContainText(/Return: \d{4}-\d{2}-\d{2}, 00:00–23:59/);

    await main.getByRole('button', { name: 'Start processing' }).click();
    await main.getByRole('button', { name: 'Mark ready' }).click();
    await main.getByRole('button', { name: 'Send out for return' }).click();
    await main.getByRole('button', { name: 'Mark returned' }).click();
    await expect(page.getByRole('heading', { name: `#${booking.bookingNumber}` })).toContainText('Completed');
    await expect(main).toContainText('Cash at return · Paid');

    const seen = await customer.get(`/laundry/bookings/${booking._id}`);
    expect(seen).toMatchObject({ status: 'completed', pricing: { finalPaise: 44000 }, payment: { balanceDuePaise: 0 } });
});
