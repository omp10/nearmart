import { expect, test } from '@playwright/test';
import { apiClient, login, pickModule, uid } from './helpers.mjs';

test('an admin sets up a service area, slots, a coupon and contact details', async ({ page, request }) => {
    const pub = apiClient(request);
    const code = `E2E${uid().toUpperCase()}`;
    await login(page);
    const main = page.getByRole('main');

    // Service area by pincode, with a delivery fee and a free-delivery threshold.
    await page.getByRole('link', { name: 'Service areas' }).click();
    await page.getByRole('button', { name: 'Add service area' }).click();
    const zoneForm = page.getByRole('dialog');
    await zoneForm.getByLabel('Name').fill(`Kothrud ${uid()}`);
    await zoneForm.getByLabel('Grocery').check();
    await zoneForm.getByLabel('Vegetables & Fresh Produce').check();
    await zoneForm.getByLabel(/Pincodes/).fill('411038, 411029');
    await zoneForm.getByLabel('Delivery fee').fill('25');
    await zoneForm.getByLabel('Free delivery above').fill('499');
    await zoneForm.getByRole('button', { name: 'Save' }).click();
    await expect(zoneForm).toBeHidden();
    await expect(main.getByRole('row', { name: /2 pincodes/ }).first()).toContainText('₹25.00');

    // The location checker finds it.
    await main.getByLabel('Pincode').fill('411029');
    await main.getByRole('button', { name: 'Check' }).click();
    await expect(main.getByRole('status')).toContainText('grocery');

    const service = await pub.get('/serviceability?pincode=411038');
    expect(service.modules).toEqual(expect.arrayContaining(['grocery', 'produce']));

    // A delivery slot every day for grocery.
    await pickModule(page, 'grocery');
    await page.getByRole('link', { name: 'Slots' }).click();
    await main.getByRole('button', { name: 'Add slot rule' }).click();
    const slotForm = page.getByRole('dialog');
    await slotForm.getByRole('button', { name: 'Sun' }).click();
    await slotForm.getByLabel('From', { exact: true }).fill('20:00');
    await slotForm.getByLabel('To', { exact: true }).fill('22:00');
    await slotForm.getByLabel('Capacity').fill('30');
    await slotForm.getByLabel('Cutoff (min)').fill('0');
    await slotForm.getByRole('button', { name: 'Save' }).click();
    await expect(slotForm).toBeHidden();
    await expect(main.getByRole('row', { name: /20:00–22:00/ }).first()).toContainText('Every day');
    const slots = await pub.get('/slots?module=grocery&pincode=411038&days=3');
    expect(slots.days.flatMap((d) => d.slots).some((s) => s.label === '20:00–22:00')).toBe(true);

    // A capped percentage coupon.
    await page.getByRole('link', { name: 'Coupons' }).click();
    await main.getByRole('button', { name: 'Add coupon' }).click();
    const couponForm = page.getByRole('dialog');
    await couponForm.getByLabel('Code').fill(code.toLowerCase());
    await couponForm.getByLabel('Description').fill('10% off, up to ₹50');
    await couponForm.getByLabel('Discount value').fill('10');
    await couponForm.getByLabel('Maximum discount (₹)').fill('50');
    await couponForm.getByLabel('Minimum order (₹)').fill('200');
    await couponForm.getByRole('button', { name: 'Save' }).click();
    await expect(couponForm).toBeHidden();
    const couponRow = main.getByRole('row', { name: new RegExp(code) });
    await expect(couponRow).toContainText('10% off up to ₹50.00 on ₹200.00+');
    await expect(couponRow).toContainText('Live');

    // Contact details appear in the app's settings, which are global.
    await pickModule(page, 'global');
    await page.getByRole('link', { name: 'Settings' }).click();
    const contact = main.locator('form', { hasText: 'Contact details' });
    await contact.getByLabel('Phone').fill('020-24567890');
    await contact.getByLabel('Support hours').fill('8 am – 10 pm, every day');
    await contact.getByRole('button', { name: 'Save' }).click();
    await expect(contact.getByRole('status')).toHaveText('Saved');
    const settings = await pub.get('/settings');
    expect(settings.contact).toMatchObject({ phone: '020-24567890', supportHours: '8 am – 10 pm, every day' });
});
