import { Router } from 'express';
import { z } from 'zod';
import { ForbiddenError } from '../../lib/errors.js';
import { ok } from '../../lib/response.js';
import { validate } from '../../lib/validate.js';
import { allowedModules, authenticate, requirePermission, requireStaff } from '../../middleware/auth.js';
import { BUSINESS_MODULES } from '../staff/permissions.js';
import { getDashboard } from './dashboard.service.js';
import { REPORT_TYPES, runReport, toCsv, toXlsx } from './report.service.js';

const router = Router();
router.use(authenticate, requireStaff());

router.get('/dashboard', validate(z.object({ module: z.enum(BUSINESS_MODULES).optional() }), 'query'), async (req, res) => {
    // Everyone signed in to the panel gets the dashboard, limited to their modules;
    // `module` narrows it to the one the panel is focused on.
    const allowed = allowedModules(req);
    const { module } = req.validatedQuery;
    if (module && allowed && !allowed.includes(module)) throw new ForbiddenError(`No access to the ${module} module`);
    ok(res, await getDashboard({ modules: module ? [module] : allowed }));
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

router.get(
    '/reports/:type',
    requirePermission('reports', 'view'),
    validate(z.object({ from: date.optional(), to: date.optional(), module: z.enum(BUSINESS_MODULES).optional(), format: z.enum(['json', 'csv', 'xlsx']).default('json') }), 'query'),
    async (req, res) => {
        const type = z.enum(REPORT_TYPES).parse(req.params.type);
        const { format, ...params } = req.validatedQuery;
        const report = await runReport(type, params, { allowedModules: allowedModules(req) });

        if (format === 'json') return ok(res, report);

        const name = `nearmart-${type}${report.range ? `-${report.range.from}-to-${report.range.to}` : ''}`;
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
            return res.send(toCsv(report));
        }
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
        return res.send(Buffer.from(await toXlsx(report)));
    }
);

export default router;
