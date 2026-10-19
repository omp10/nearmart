import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    // undefined = still checking for an existing session; null = signed out.
    const [user, setUser] = useState(undefined);

    useEffect(() => {
        setSessionLostHandler(() => setUser(null));
        let cancelled = false;
        refreshSession()
            .then(() => api.get('/auth/me'))
            .then((res) => !cancelled && setUser(res.data.data))
            .catch(() => !cancelled && setUser(null));
        return () => {
            cancelled = true;
        };
    }, []);

    const login = useCallback(async (email, password) => {
        const res = await api.post('/auth/staff/login', { email, password }, { skipAuthRefresh: true });
        setAccessToken(res.data.data.accessToken);
        setUser(res.data.data.user);
    }, []);

    const logout = useCallback(async () => {
        try {
            await api.post('/auth/logout', {}, { skipAuthRefresh: true });
        } finally {
            setAccessToken(null);
            setUser(null);
        }
    }, []);

    /** Mirrors the API's requirePermission: super admins can do everything. */
    const can = useCallback(
        (section, action = 'view') =>
            Boolean(user && (user.isSuperAdmin || user.permissions?.[section]?.includes(action))),
        [user]
    );

    const value = useMemo(() => ({ user, login, logout, can }), [user, login, logout, can]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
};
