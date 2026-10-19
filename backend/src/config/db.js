import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

mongoose.set('strictQuery', true);

export const connectDB = async (uri = env.MONGO_URI) => {
    const conn = await mongoose.connect(uri);
    logger.info({ host: conn.connection.host, db: conn.connection.name }, 'MongoDB connected');
    return conn;
};

export const disconnectDB = async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
};

export const isDbConnected = () => mongoose.connection.readyState === 1;
