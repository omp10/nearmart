/**
 * Creates every index the models declare (and drops ones they no longer do).
 * Run after each deploy that changes a model:  npm run db:indexes
 *
 * Production runs with autoIndex off, so index builds happen here, at a
 * time you choose, instead of on whichever request first touches a model.
 */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import '../src/app.js'; // registers every model

await connectDB();
try {
    for (const name of mongoose.modelNames()) {
        const dropped = await mongoose.model(name).syncIndexes();
        console.log(`${name.padEnd(20)} ok${dropped.length ? ` (dropped ${dropped.join(', ')})` : ''}`);
    }
} finally {
    await disconnectDB();
}
