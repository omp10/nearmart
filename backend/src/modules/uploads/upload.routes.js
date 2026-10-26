import { Router } from 'express';
import multer from 'multer';
import { env } from '../../config/env.js';
import { created } from '../../lib/response.js';
import { authenticate } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rateLimit.js';
import { saveImage } from './storage.service.js';

const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.UPLOAD_MAX_IMAGE_MB * 1024 * 1024, files: 1 }
});

const router = Router();

/**
 * POST /api/v1/uploads/image?folder=catalog   (multipart field: file)
 * Staff may write to any folder; customers only to `profiles`.
 */
router.post('/image', authenticate, uploadLimiter, imageUpload.single('file'), async (req, res) => {
    const folder = req.auth.kind === 'user' ? 'profiles' : String(req.query.folder || 'misc');
    created(res, await saveImage(req.file, folder), 'Image uploaded');
});

export default router;
