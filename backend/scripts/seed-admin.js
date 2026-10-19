/**
 * Creates the first super admin. Run once per environment:
 *
 *   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='a-long-password' npm run seed:admin
 *
 * Refuses to run if a super admin already exists, so it can't be used to
 * take over a live install.
 */
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Staff } from '../src/modules/staff/staff.model.js';
import { STAFF_ROLES } from '../src/modules/staff/permissions.js';

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const name = process.env.SEED_ADMIN_NAME || 'Super Admin';

if (!email || !password || password.length < 10) {
    console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (10+ characters).');
    process.exit(1);
}

await connectDB();
try {
    if (await Staff.exists({ isSuperAdmin: true })) {
        console.error('A super admin already exists; nothing changed.');
        process.exitCode = 1;
    } else {
        await Staff.create({ email, password, name, role: STAFF_ROLES.ADMIN, isSuperAdmin: true });
        console.log(`Super admin created: ${email}`);
    }
} finally {
    await disconnectDB();
}
