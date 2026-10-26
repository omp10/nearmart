import { expect, test } from '@playwright/test';
import { apiClient, login, uid } from './helpers.mjs';

test('an ops user sees only their module and permissions; access changes and lockouts are handled', async ({ page, browser, request }) => {
    const email = `packer-${uid()}@nearmart.test`;
    const password = 'packer-password-1';

    // The admin creates a grocery packer who can see and update orders.
    await login(page);
    await page.getByRole('link', { name: 'Staff & roles' }).click();
    await page.getByRole('button', { name: 'Add staff' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Name').fill('Grocery Packer');
    await form.getByLabel('Email').fill(email);
    await form.getByLabel('Temporary password').fill(password);
    await form.getByLabel('Grocery').check();
    await form.getByLabel('Orders: view').check();
    await form.getByLabel('Orders: update').check();
    await form.getByRole('button', { name: 'Create' }).click();
    const row = page.getByRole('main').getByRole('row', { name: new RegExp(email) });
    await expect(row).toContainText('Operations');
    await expect(row).toContainText('grocery');

    // The packer's panel: only Orders, no module switcher (they have one module).
    const packerContext = await browser.newContext();
    const packer = await packerContext.newPage();
    await login(packer, { email, password });
    await expect(packer.getByRole('radiogroup', { name: 'Module' })).toHaveCount(0);
    await expect(packer.getByRole('link', { name: 'Orders', exact: true })).toBeVisible();
    await expect(packer.getByRole('link', { name: 'Products', exact: true })).toHaveCount(0);
    await expect(packer.getByRole('link', { name: 'Staff & roles' })).toHaveCount(0);

    // The admin adds catalogue viewing; it shows after the packer reloads, with no sign-out.
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('dialog').getByLabel('Catalogue (categories & products): view').check();
    await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await packer.reload();
    await expect(packer.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
    await packer.getByRole('link', { name: 'Products', exact: true }).click();
    await expect(packer.getByRole('heading', { name: 'Products' })).toBeVisible();
    await packerContext.close();

    // Too many wrong passwords lock the account; the admin unlocks it with a new password.
    const anon = apiClient(request);
    for (let i = 0; i < 8; i += 1) {
        await anon.post('/auth/staff/login', { email, password: 'wrong-password' }).catch(() => {});
    }
    await page.reload();
    const lockedRow = page.getByRole('main').getByRole('row', { name: new RegExp(email) });
    await expect(lockedRow).toContainText('Locked');
    await lockedRow.getByRole('button', { name: 'Unlock' }).click();
    await page.getByRole('dialog').getByLabel('New password').fill('a-fresh-password-2');
    await page.getByRole('dialog').getByRole('button', { name: 'Reset password' }).click();
    await expect(lockedRow).not.toContainText('Locked');

    const again = await browser.newContext();
    const retry = await again.newPage();
    await login(retry, { email, password: 'a-fresh-password-2' });
    await again.close();
});
