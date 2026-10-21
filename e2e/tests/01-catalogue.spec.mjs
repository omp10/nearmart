import { expect, test } from '@playwright/test';
import { apiClient, login, uid } from './helpers.mjs';

test.describe('catalogue', () => {
    test('the module switcher drives every module page and is remembered', async ({ page }) => {
        await login(page);
        const switcher = page.getByRole('combobox', { name: 'Module' });
        await switcher.selectOption('electronics');

        await page.getByRole('link', { name: 'Categories' }).click();
        await expect(page.getByRole('tab', { name: 'Electrical & Electronics' })).toHaveAttribute('aria-selected', 'true');

        // In-page tabs move the header switcher too.
        await page.getByRole('tab', { name: 'Vegetables & Fresh Produce' }).click();
        await expect(switcher).toHaveValue('produce');

        await page.reload();
        await expect(page.getByRole('combobox', { name: 'Module' })).toHaveValue('produce');

        // Laundry has no products: the products page says where to go instead.
        await page.getByRole('combobox', { name: 'Module' }).selectOption('laundry');
        await page.getByRole('link', { name: 'Products', exact: true }).click();
        await expect(page.getByText('Laundry has no products')).toBeVisible();
    });

    test('an admin adds categories and a product with variants, prices and stock', async ({ page, request }) => {
        const name = `Spinach ${uid()}`;
        await login(page);
        await page.getByRole('combobox', { name: 'Module' }).selectOption('produce');
        await page.getByRole('link', { name: 'Categories' }).click();

        // Category, then a subcategory under it.
        const parent = `Leafy Greens ${uid()}`;
        await page.getByRole('button', { name: 'Add category' }).click();
        await page.getByLabel('Name').fill(parent);
        await page.getByRole('button', { name: 'Save' }).click();
        const parentRow = page.locator('div.flex.items-center', { hasText: parent }).first();
        await expect(parentRow).toBeVisible();
        await parentRow.getByRole('button', { name: '+ Sub' }).click();
        await page.getByLabel('Name').fill('Spinach & Methi');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Spinach & Methi')).toBeVisible();

        // Product with two pack sizes; one has an offer price with paise.
        await page.getByRole('link', { name: 'Products', exact: true }).click();
        await page.getByRole('link', { name: 'Add product' }).click();
        const main = page.getByRole('main');
        await expect(page).toHaveURL(/\/products\/new/);
        await expect(main.locator('#p-module')).toHaveValue('produce');
        await main.getByLabel('Category').selectOption({ label: `${parent} › Spinach & Methi` });
        await main.getByLabel('Name', { exact: true }).fill(name);
        await main.getByLabel('Brand').fill('Farm Fresh');
        await main.getByLabel('GST (included in prices)').selectOption('5');
        await main.getByLabel('Handling note').fill('Refrigerate after delivery');

        await main.getByLabel('Variant 1 label').fill('250 g');
        await main.getByLabel('Variant 1 unit').selectOption('g');
        await main.getByLabel('Variant 1 quantity').fill('250');
        await main.getByLabel('Variant 1 selling price').fill('30');
        await main.getByLabel('Variant 1 offer price').fill('25.50');
        await main.getByLabel('Variant 1 stock').fill('40');
        await page.getByRole('button', { name: '+ Add variant' }).click();
        await main.getByLabel('Variant 2 label').fill('500 g');
        await main.getByLabel('Variant 2 unit').selectOption('g');
        await main.getByLabel('Variant 2 quantity').fill('500');
        await main.getByLabel('Variant 2 selling price').fill('55');
        await main.getByLabel('Variant 2 stock').fill('20');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page).toHaveURL(/\/products\/[a-f0-9]{24}$/);

        // An offer at or above the selling price is refused with a clear message.
        await main.getByLabel('Variant 2 offer price').fill('60');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('alert')).toContainText('Offer price for "500 g" must be below its selling price');
        await main.getByLabel('Variant 2 offer price').fill('49.99');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByText('Saved.')).toBeVisible();

        // Existing variants' stock is read-only in the editor.
        await expect(main.getByLabel('Variant 1 stock')).toBeDisabled();

        // The list shows the lowest price a customer pays.
        await page.getByRole('link', { name: '← Products' }).click();
        await page.getByLabel('Search products').fill(name);
        const row = page.getByRole('row', { name: new RegExp(name) });
        await expect(row).toContainText('₹25.50');
        await expect(row).toContainText('60'); // total stock

        // The customer app sees exactly these prices (paise) and no stock counts.
        const products = await apiClient(request).get(`/catalog/products?module=produce&q=${encodeURIComponent(name.split(' ')[0])}`);
        const product = products.items.find((p) => p.name === name);
        expect(product.variants.map((v) => [v.label, v.pricePaise, v.effectivePricePaise, v.inStock])).toEqual([
            ['250 g', 3000, 2550, true],
            ['500 g', 5500, 4999, true]
        ]);
        expect(JSON.stringify(product)).not.toContain('stockQty');

        // Restock from the inventory page; the history records it.
        await page.getByRole('link', { name: 'Inventory' }).click();
        await page.getByLabel('Search inventory').fill(name);
        const inv = page.getByRole('row', { name: /250 g/ });
        await inv.getByRole('button', { name: 'Update stock' }).click();
        await page.getByLabel('Quantity').fill('10');
        await page.getByLabel('Note (optional)').fill('Morning delivery');
        await page.getByRole('button', { name: 'Save' }).click();
        await expect(inv).toContainText('50');
        await inv.getByRole('button', { name: 'History' }).click();
        const history = page.getByRole('dialog');
        await expect(history).toContainText('+10');
        await expect(history).toContainText('Morning delivery');
        await expect(history).toContainText('Opening stock');
    });
});
