import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { apiClient, customerApi, login, phone, pickModule, uid } from './helpers.mjs';

// A valid 1×1 PNG.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);

test('banners: upload an image, schedule, and the app sees only live ones', async ({ page, request }) => {
    const title = `Diwali Sale ${uid()}`;
    await login(page);
    const main = page.getByRole('main');
    await page.getByRole('link', { name: 'Banners' }).click();
    // Home screen banners are shared by every module, so they live under Global.
    await pickModule(page, 'global');
    await main.getByRole('button', { name: 'Add banner' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel(/Title/).fill(title);
    await form.locator('input[type=file]').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: PNG });
    await expect(form.locator('img')).toBeVisible();
    await form.getByLabel('On tap, open').selectOption('module');
    await form.getByLabel('Module', { exact: true }).selectOption('grocery');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form).toBeHidden();
    await expect(main.getByText(title)).toBeVisible();

    const live = await apiClient(request).get('/banners');
    const banner = live.find((b) => b.title === title);
    expect(banner.link).toEqual({ type: 'module', value: 'grocery' });
    expect(banner.image).toMatch(/\/uploads\/banners\/.+\.webp$/);

    // Its image is really served.
    const img = await request.get(`http://localhost:5174${banner.image}`);
    expect(img.ok()).toBe(true);
    expect(img.headers()['content-type']).toContain('image/webp');
});

test('customers: search, see history, deactivate signs them out', async ({ page, request }) => {
    const number = phone();
    const customer = await customerApi(request, number, `Meera ${uid()}`);
    await customer.post('/me/addresses', { line1: '3 FC Road', city: 'Pune', state: 'Maharashtra', pincode: '411004' });

    await login(page);
    const main = page.getByRole('main');
    await page.getByRole('link', { name: 'Customers', exact: true }).click();
    await main.getByLabel('Search customers').fill(number);
    await main.getByRole('link', { name: /Meera/ }).click();
    await expect(main).toContainText(number);
    await expect(main).toContainText('3 FC Road');

    page.on('dialog', (d) => d.accept());
    await main.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByRole('heading', { name: /Meera/ })).toContainText('Deactivated');
    await expect(customer.get('/cart')).rejects.toThrow(/401/);

    await main.getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByRole('heading', { name: /Meera/ })).toContainText('Active');
});

test('reports download as CSV and Excel', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Reports' }).click();
    const main = page.getByRole('main');
    await expect(main.getByText(/rows$/).or(main.getByText(/\d+ rows/))).toBeVisible();

    const [csv] = await Promise.all([page.waitForEvent('download'), main.getByRole('button', { name: 'Download CSV' }).click()]);
    expect(csv.suggestedFilename()).toMatch(/^nearmart-orders-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await fs.readFile(await csv.path(), 'utf8');
    expect(text.split('\r\n')[0]).toContain('Order,Placed (IST),Module,Status');

    const [xlsx] = await Promise.all([page.waitForEvent('download'), main.getByRole('button', { name: 'Download Excel' }).click()]);
    expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
    const bytes = await fs.readFile(await xlsx.path());
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
});
