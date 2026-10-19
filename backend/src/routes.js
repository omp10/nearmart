import { Router } from 'express';
import { isDbConnected } from './config/db.js';
import authRoutes from './modules/auth/auth.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import paymentRoutes from './modules/payments/payment.routes.js';
import staffRoutes from './modules/staff/staff.routes.js';
import uploadRoutes from './modules/uploads/upload.routes.js';

/**
 * Everything under /api/v1. Path prefixes by audience, as modules land:
 *   /auth, /notifications, /uploads, /payments  shared
 *   /admin/*                                    admin panel (staff permissions)
 *   /ops/*                                      operations / vendor panel
 *   everything else                             customer app
 */
const router = Router();

router.get('/health', (_req, res) => {
    const db = isDbConnected();
    res.status(db ? 200 : 503).json({ success: db, status: db ? 'up' : 'degraded', db: db ? 'connected' : 'disconnected' });
});

router.use('/auth', authRoutes);
router.use('/notifications', notificationRoutes);
router.use('/uploads', uploadRoutes);
router.use('/payments', paymentRoutes);
router.use('/admin/staff', staffRoutes);

export default router;
