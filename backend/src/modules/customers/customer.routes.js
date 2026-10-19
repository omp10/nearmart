import { Router } from 'express';
import { z } from 'zod';
import { created, ok } from '../../lib/response.js';
import { normalizeIndianPhone, validate } from '../../lib/validate.js';
import { authenticate, requireCustomer } from '../../middleware/auth.js';
import * as customers from './customer.service.js';

/** The signed-in customer's own profile and saved addresses (scope §2). */
const router = Router();
router.use(authenticate, requireCustomer);

const optionalPhone = z
    .string()
    .trim()
    .transform((v, ctx) => {
        if (!v) return '';
        const phone = normalizeIndianPhone(v);
        if (!phone) ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit mobile number' });
        return phone;
    });

router.patch(
    '/',
    validate(
        z.object({
            name: z.string().trim().min(1).max(80).optional(),
            email: z.union([z.string().trim().toLowerCase().email(), z.literal('')]).optional(),
            profileImage: z.string().trim().max(500).optional(),
            preferences: z.object({ notifications: z.boolean() }).partial().optional()
        })
    ),
    async (req, res) => {
        ok(res, await customers.updateProfile(req.auth.id, req.body), 'Profile updated');
    }
);

const addressFields = {
    label: z.enum(['home', 'work', 'other']).optional(),
    name: z.string().trim().max(80).optional(),
    phone: optionalPhone.optional(),
    line1: z.string().trim().min(3, 'Enter the house / flat and street').max(200),
    line2: z.string().trim().max(200).optional(),
    landmark: z.string().trim().max(120).optional(),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().min(2).max(80),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Pincodes are 6 digits'),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    isDefault: z.boolean().optional()
};

const bothOrNeither = (v) => (v.lat == null) === (v.lng == null);
const coordsMessage = { message: 'Send lat and lng together', path: ['lat'] };

router.get('/addresses', async (req, res) => {
    ok(res, await customers.listAddresses(req.auth.id));
});

router.post('/addresses', validate(z.object(addressFields).refine(bothOrNeither, coordsMessage)), async (req, res) => {
    created(res, await customers.addAddress(req.auth.id, req.body), 'Address saved');
});

router.patch(
    '/addresses/:addressId',
    validate(z.object(addressFields).partial().refine(bothOrNeither, coordsMessage)),
    async (req, res) => {
        ok(res, await customers.updateAddress(req.auth.id, req.params.addressId, req.body), 'Address updated');
    }
);

router.delete('/addresses/:addressId', async (req, res) => {
    await customers.deleteAddress(req.auth.id, req.params.addressId);
    ok(res, null, 'Address removed');
});

export default router;
