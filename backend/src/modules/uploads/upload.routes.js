import { Router } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { created } from '../../lib/response.js';
import { ForbiddenError } from '../../lib/errors.js';
import { authenticate } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rateLimit.js';
import { saveImage, saveVideo } from './storage.service.js';

const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.UPLOAD_MAX_IMAGE_MB * 1024 * 1024, files: 1 }
});

const videoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.UPLOAD_MAX_VIDEO_MB * 1024 * 1024, files: 1 }
});

/** Customers write only to `profiles`, delivery partners only to `deliveries`; staff choose. */
const FIXED_FOLDER = { user: 'profiles', rider: 'deliveries' };

/** Staff who can add or edit banners. */
const canEditBanners = (req, _res, next) => {
    const auth = req.auth;
    const ok = auth?.kind === 'staff' && (auth.isSuperAdmin || ['create', 'update'].some((a) => (auth.permissions?.banners || []).includes(a)));
    return ok ? next() : next(new ForbiddenError());
};

const router = Router();

/** POST /api/v1/uploads/image?folder=catalog   (multipart field: file) */
router.post('/image', authenticate, uploadLimiter, imageUpload.single('file'), async (req, res) => {
    const folder = FIXED_FOLDER[req.auth.kind] ?? String(req.query.folder || 'misc');
    created(res, await saveImage(req.file, folder), 'Image uploaded');
});

/** POST /api/v1/uploads/video?folder=banners   (multipart field: file) — banner clips, staff only. */
router.post('/video', authenticate, canEditBanners, uploadLimiter, videoUpload.single('file'), async (req, res) => {
    created(res, await saveVideo(req.file, String(req.query.folder || 'banners')), 'Video uploaded');
});

export default router;
