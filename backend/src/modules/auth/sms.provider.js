import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * Delivers an OTP. Swapping SMS vendors (scope §9 leaves the provider open)
 * means adding one function here and an enum value in env.js.
 */

const renderMessage = (code) => env.SMS_OTP_TEMPLATE.replaceAll('{otp}', code);

const consoleProvider = async (phone, code) => {
    // Development only; env.js refuses this provider in production.
    logger.info(`[sms:console] OTP for ${phone}: ${code}`);
};

const smsIndiaHubProvider = async (phone, code) => {
    const url = new URL('https://cloud.smsindiahub.in/vendorsms/pushsms.aspx');
    url.searchParams.set('APIKey', env.SMS_INDIA_HUB_API_KEY);
    url.searchParams.set('sid', env.SMS_INDIA_HUB_SENDER_ID);
    url.searchParams.set('msisdn', `91${phone}`);
    url.searchParams.set('msg', renderMessage(code));
    url.searchParams.set('gwid', '2');
    url.searchParams.set('fl', '0');
    if (env.SMS_INDIA_HUB_USERNAME) url.searchParams.set('uname', env.SMS_INDIA_HUB_USERNAME);
    if (env.SMS_INDIA_HUB_DLT_TEMPLATE_ID) url.searchParams.set('DLT_TE_ID', env.SMS_INDIA_HUB_DLT_TEMPLATE_ID);

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const text = await response.text();

    // The vendor answers HTTP 200 for most failures; the body carries the error.
    let body = null;
    try {
        body = JSON.parse(text);
    } catch {
        /* plain-text success responses are normal */
    }
    if (!response.ok || (body?.ErrorCode && body.ErrorCode !== '000')) {
        // 006 = message text does not match the DLT-registered template.
        throw new Error(`SMS India Hub error ${body?.ErrorCode ?? response.status}: ${body?.ErrorMessage ?? text}`);
    }
};

const providers = {
    console: consoleProvider,
    smsindiahub: smsIndiaHubProvider
};

export const sendOtpSms = (phone, code) => providers[env.SMS_PROVIDER](phone, code);
