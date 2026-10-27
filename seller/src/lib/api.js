import axios from 'axios';

/**
 * The access token is kept in memory only. The refresh token is the httpOnly
 * nm_srt cookie set by the API on /auth/seller/*, so a page reload recovers
 * the session through /auth/seller/refresh without any token ever being
 * readable by scripts.
 */
let accessToken = null;
let onSessionLost = () => {};

export const setAccessToken = (token) => {
    accessToken = token;
};

export const setSessionLostHandler = (fn) => {
    onSessionLost = fn;
};

export const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
    withCredentials: true
});

api.interceptors.request.use((config) => {
    if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
    return config;
});

const postRefresh = () =>
    api.post('/auth/seller/refresh', {}, { skipAuthRefresh: true }).catch(async (error) => {
        // Another tab rotated the cookie a moment ago; the browser now has the new one.
        if (error.response?.data?.code !== 'REFRESH_RACE') throw error;
        await new Promise((r) => setTimeout(r, 300));
        return api.post('/auth/seller/refresh', {}, { skipAuthRefresh: true });
    });

// One refresh at a time: parallel 401s all wait on the same request.
let refreshing = null;
export const refreshSession = () => {
    refreshing ??= postRefresh()
        .then((res) => {
            setAccessToken(res.data.data.accessToken);
            return res.data.data.accessToken;
        })
        .finally(() => {
            refreshing = null;
        });
    return refreshing;
};

api.interceptors.response.use(
    (res) => res,
    async (error) => {
        const original = error.config;
        if (error.response?.status !== 401 || !original || original.skipAuthRefresh || original._retried) {
            throw error;
        }
        original._retried = true;
        try {
            await refreshSession();
        } catch {
            setAccessToken(null);
            onSessionLost();
            throw error;
        }
        return api(original);
    }
);

/** The API's `message` when there is one, so forms can show it as is. */
export const errorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
    if (typeof error === 'string') return error;
    if (error?.response?.data?.message) return error.response.data.message;
    if (error?.code === 'ERR_NETWORK') return 'Could not reach Nearmart. Check your internet connection and try again.';
    return error?.message || fallback;
};

/** Field errors from a validation failure: { 'address.pincode': 'Enter a 6-digit pincode' }. */
export const fieldErrors = (error) =>
    Object.fromEntries((error?.response?.data?.details ?? []).filter((d) => d?.path).map((d) => [d.path, d.message]));
