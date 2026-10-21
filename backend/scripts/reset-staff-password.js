/**
 * Recovery for when nobody who can reset passwords in the panel can sign in
 * (e.g. the only super admin forgot theirs). Needs shell access to the server,
 * which is the authorisation.
 *
 *   STAFF_EMAIL=owner@client.com NEW_PASSWORD='a-long-new-password' npm run staff:reset-password
 *
 * Sets the password, unlocks and re-activates the account, and signs out
 * every existing session of it.
 */
import { connectDB, disconnectDB } from '../src/config/db.js';
import { revokeAllForSubject } from '../src/modules/auth/token.service.js';
import { Staff } from '../src/modules/staff/staff.model.js';

const email = String(process.env.STAFF_EMAIL || '').toLowerCase().trim();
const password = process.env.NEW_PASSWORD || '';

if (!email || password.length < 10) {
    console.error('Set STAFF_EMAIL and NEW_PASSWORD (10+ characters).');
    process.exit(1);
}

await connectDB();
try {
    const staff = await Staff.findOne({ email });
    if (!staff) {
        console.error(`No staff account with email ${email}.`);
        process.exitCode = 1;
    } else {
        staff.password = password;
        staff.tokenVersion += 1;
        staff.failedLogins = 0;
        staff.lockedUntil = null;
        staff.isActive = true;
        await staff.save();
        await revokeAllForSubject(staff._id, 'staff');
        console.log(`Password reset for ${email}${staff.isSuperAdmin ? ' (super admin)' : ''}; account unlocked and active; old sessions signed out.`);
    }
} finally {
    await disconnectDB();
}
