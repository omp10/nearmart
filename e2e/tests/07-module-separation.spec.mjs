import { expect, test } from '@playwright/test';
import { adminApi, login, moduleTab, pickModule, uid } from './helpers.mjs';

/**
 * Each module tab works as its own panel: the menu, every list and the
 * dashboard show only that module's records, and pages that don't exist in a
 * module (Orders in Laundry, say) hand over to their counterpart.
 */

const sidebar = (page) => page.getByRole('navigation', { name: 'Main' });
const navLink = (page, name) => sidebar(page).getByRole('link', { name, exact: true });

/** A category and one product in it, created through the API. */
const seedProduct = async (admin, module, name) => {
    const category = await admin.post('/admin/catalog/categories', { module, name: `Cat ${uid()}` });
    return admin.post('/admin/catalog/products', {
        module,
        category: category._id,
        name,
        variants: [{ label: '1 pc', pricePaise: 10000, stockQty: 5 }]
    });
};

test('the menu changes with the module, and pages hand over to their counterpart', async ({ page }) => {
    await login(page);

    await pickModule(page, 'grocery');
    for (const name of ['Orders', 'Products', 'Inventory', 'Coupons']) await expect(navLink(page, name)).toBeVisible();
    for (const name of ['Laundry bookings', 'Laundry services']) await expect(navLink(page, name)).toHaveCount(0);

    await pickModule(page, 'laundry');
    for (const name of ['Laundry bookings', 'Laundry services']) await expect(navLink(page, name)).toBeVisible();
    for (const name of ['Orders', 'Products', 'Inventory', 'Coupons']) await expect(navLink(page, name)).toHaveCount(0);
    // Shared pages stay in every module.
    for (const name of ['Dashboard', 'Customers', 'Categories', 'Service areas', 'Slots', 'Banners', 'Reports']) {
        await expect(navLink(page, name)).toBeVisible();
    }

    // Orders ↔ Laundry bookings, Products ↔ Laundry services.
    await pickModule(page, 'grocery');
    await navLink(page, 'Orders').click();
    await pickModule(page, 'laundry');
    await expect(page).toHaveURL(/\/bookings$/);
    await pickModule(page, 'produce');
    await expect(page).toHaveURL(/\/orders$/);

    await navLink(page, 'Products').click();
    await pickModule(page, 'laundry');
    await expect(page).toHaveURL(/\/laundry-services$/);
    await pickModule(page, 'electronics');
    await expect(page).toHaveURL(/\/products$/);

    // Inventory and Coupons have no laundry counterpart: back to the dashboard.
    await navLink(page, 'Inventory').click();
    await pickModule(page, 'laundry');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Laundry Services overview')).toBeVisible();

    // A shared page stays put.
    await navLink(page, 'Service areas').click();
    await pickModule(page, 'grocery');
    await expect(page).toHaveURL(/\/zones$/);
});

test('products, categories and inventory are separate for each module', async ({ page, request }) => {
    const admin = await adminApi(request);
    const groceryItem = `Basmati ${uid()}`;
    const electronicsItem = `Kettle ${uid()}`;
    const produceItem = `Okra ${uid()}`;
    await seedProduct(admin, 'grocery', groceryItem);
    await seedProduct(admin, 'electronics', electronicsItem);
    await seedProduct(admin, 'produce', produceItem);

    await login(page);
    const main = page.getByRole('main');

    await pickModule(page, 'grocery');
    await navLink(page, 'Products').click();
    await expect(main.getByText(groceryItem)).toBeVisible();
    await expect(main.getByText(electronicsItem)).toHaveCount(0);
    await expect(main.getByText(produceItem)).toHaveCount(0);

    await pickModule(page, 'electronics');
    await expect(main.getByText(electronicsItem)).toBeVisible();
    await expect(main.getByText(groceryItem)).toHaveCount(0);

    await pickModule(page, 'produce');
    await expect(main.getByText(produceItem)).toBeVisible();
    await expect(main.getByText(electronicsItem)).toHaveCount(0);

    await navLink(page, 'Inventory').click();
    await expect(main.getByText(produceItem)).toBeVisible();
    await pickModule(page, 'grocery');
    await expect(main.getByText(groceryItem)).toBeVisible();
    await expect(main.getByText(produceItem)).toHaveCount(0);

    // An open product belongs to its module: switching leaves it for the new module's list.
    await navLink(page, 'Products').click();
    await main.getByRole('link', { name: groceryItem }).click();
    await expect(page).toHaveURL(/\/products\/[a-f0-9]{24}$/);
    await pickModule(page, 'electronics');
    await expect(page).toHaveURL(/\/products$/);
    await expect(main.getByText(electronicsItem)).toBeVisible();

    // A new product is created in the selected module.
    await main.getByRole('link', { name: 'Add product' }).click();
    await expect(page.getByRole('combobox', { name: 'Module' })).toHaveValue('electronics');
    await expect(page.getByRole('combobox', { name: 'Module' })).toBeDisabled();

    // Opening a product directly moves the panel to its module.
    await page.goto('/products');
    await pickModule(page, 'grocery');
    await main.getByRole('link', { name: groceryItem }).click();
    await page.goto('/');
    await pickModule(page, 'produce');
    await page.goBack();
    await expect(moduleTab(page, 'grocery')).toHaveAttribute('aria-checked', 'true');
});

test('the dashboard shows only the selected module', async ({ page, request }) => {
    const admin = await adminApi(request);
    const before = {
        grocery: (await admin.get('/admin/dashboard?module=grocery')).catalogue.byModule[0].active,
        electronics: (await admin.get('/admin/dashboard?module=electronics')).catalogue.byModule[0].active
    };
    await seedProduct(admin, 'electronics', `Fan ${uid()}`);

    await login(page);
    const main = page.getByRole('main');
    const productsTile = main.getByRole('link', { name: /^Products/ });

    await pickModule(page, 'grocery');
    await expect(main.getByText('Grocery overview')).toBeVisible();
    await expect(productsTile).toContainText(String(before.grocery));

    await pickModule(page, 'electronics');
    await expect(main.getByText(/Electrical & Electronics overview/)).toBeVisible();
    await expect(productsTile).toContainText(String(before.electronics + 1));

    await pickModule(page, 'laundry');
    await expect(main.getByText('Laundry Services overview')).toBeVisible();
    await expect(main.getByText('New pickup requests')).toBeVisible();
    await expect(main.getByText('Laundry to weigh')).toBeVisible();
    await expect(productsTile).toHaveCount(0);
    await expect(main.getByText('Bookings, last 7 days')).toBeVisible();
});

test('coupons, service areas and banners are listed per module', async ({ page, request }) => {
    const admin = await adminApi(request);
    const electronicsCoupon = `ELEC${uid().toUpperCase()}`;
    const everywhereCoupon = `ALL${uid().toUpperCase()}`;
    await admin.post('/admin/coupons', { code: electronicsCoupon, type: 'percent', value: 10, modules: ['electronics'] });
    await admin.post('/admin/coupons', { code: everywhereCoupon, type: 'flat', value: 5000 });

    const produceArea = `Baner ${uid()}`;
    await admin.post('/admin/zones', { name: produceArea, modules: ['produce'], pincodes: ['411045'] });

    const groceryBanner = `Grocery fest ${uid()}`;
    const homeBanner = `Welcome ${uid()}`;
    await admin.post('/admin/banners', { title: groceryBanner, image: '/uploads/banners/x.webp', placement: 'grocery' });
    await admin.post('/admin/banners', { title: homeBanner, image: '/uploads/banners/x.webp', placement: 'home' });

    await login(page);
    const main = page.getByRole('main');

    // Coupons: module-specific ones only under their module; "all modules" ones everywhere.
    await pickModule(page, 'grocery');
    await navLink(page, 'Coupons').click();
    await expect(main.getByText(everywhereCoupon)).toBeVisible();
    await expect(main.getByText(electronicsCoupon)).toHaveCount(0);
    await pickModule(page, 'electronics');
    await expect(main.getByText(electronicsCoupon)).toBeVisible();
    await expect(main.getByRole('row', { name: new RegExp(everywhereCoupon) })).toContainText('All modules');
    // A new coupon starts limited to the selected module.
    await main.getByRole('button', { name: 'Add coupon' }).click();
    const couponForm = page.getByRole('dialog');
    await expect(couponForm.getByLabel('Electrical & Electronics')).toBeChecked();
    await expect(couponForm.getByLabel('Grocery')).not.toBeChecked();
    await couponForm.getByRole('button', { name: 'Cancel' }).click();

    // Service areas.
    await navLink(page, 'Service areas').click();
    await expect(main.getByText(produceArea)).toHaveCount(0);
    await pickModule(page, 'produce');
    await expect(main.getByText(produceArea)).toBeVisible();
    await main.getByRole('button', { name: 'Add service area' }).click();
    await expect(page.getByRole('dialog').getByLabel('Vegetables & Fresh Produce')).toBeChecked();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    // Banners: each module's page has its own; the home screen is shared.
    await navLink(page, 'Banners').click();
    await expect(main.getByText(groceryBanner)).toHaveCount(0);
    await pickModule(page, 'grocery');
    await expect(main.getByText(groceryBanner)).toBeVisible();
    await expect(main.getByText(homeBanner)).toHaveCount(0);
    await main.getByRole('tab', { name: 'App home screen' }).click();
    await expect(main.getByText(homeBanner)).toBeVisible();
    await expect(main.getByText(groceryBanner)).toHaveCount(0);
});

test('reports start on the selected module', async ({ page }) => {
    await login(page);
    await pickModule(page, 'produce');
    await navLink(page, 'Reports').click();
    await expect(page.getByRole('combobox', { name: 'Module' })).toHaveValue('produce');
    await pickModule(page, 'electronics');
    await expect(page.getByRole('combobox', { name: 'Module' })).toHaveValue('electronics');
});
