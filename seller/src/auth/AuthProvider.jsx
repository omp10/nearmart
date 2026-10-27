import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from '../lib/api.js';

const AuthContext = createContext(null);

/**
 * The signed-in seller's own profile (GET /seller/me), which also decides
 * which screens to show: the application, "under review", or the full app.
 */
export function AuthProvider({ children }) {
    const queryClient = useQueryClient();
    // undefined = still checking for an existing session; null = signed out.
    const [seller, setSeller] = useState(undefined);

    useEffect(() => {
        setSessionLostHandler(() => setSeller(null));
        let cancelled = false;
        refreshSession()
            .then(() => api.get('/seller/me'))
            .then((res) => !cancelled && setSeller(res.data.data))
            .catch(() => !cancelled && setSeller(null));
        return () => {
            cancelled = true;
        };
    }, []);

    const startSession = useCallback((data) => {
        setAccessToken(data.accessToken);
        setSeller(data.seller);
    }, []);

    const login = useCallback(
        async (login, password) => {
            const res = await api.post('/auth/seller/login', { login, password }, { skipAuthRefresh: true });
            startSession(res.data.data);
        },
        [startSession]
    );

    const signup = useCallback(
        async (body) => {
            const res = await api.post('/auth/seller/signup', body, { skipAuthRefresh: true });
            startSession(res.data.data);
        },
        [startSession]
    );

    /** Forgets the session locally (after a password change the API has already ended it). */
    const endSession = useCallback(() => {
        setAccessToken(null);
        setSeller(null);
        queryClient.clear();
    }, [queryClient]);

    const logout = useCallback(async () => {
        try {
            await api.post('/auth/seller/logout', {}, { skipAuthRefresh: true });
        } catch {
            // Signed out locally either way.
        } finally {
            endSession();
        }
    }, [endSession]);

    const reloadSeller = useCallback(async () => {
        const res = await api.get('/seller/me');
        setSeller(res.data.data);
        return res.data.data;
    }, []);

    const value = useMemo(
        () => ({ seller, setSeller, reloadSeller, login, signup, logout, endSession }),
        [seller, reloadSeller, login, signup, logout, endSession]
    );
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
};
