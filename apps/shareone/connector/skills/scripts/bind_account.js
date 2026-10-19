#!/usr/bin/env node

// Account binding script: send verification code to email, then verify to bind
// email to an existing guest API key (upgrading guest → registered user).
//
// Usage:
//   node bind_account.js --send --email user@example.com
//   node bind_account.js --verify --email user@example.com --code 123456

const {
    detectCredentialMode,
    getBaseUrl,
    readLocalApiKey,
    requestPublicShareOneJson,
    resolveDirectApiKey,
} = require('./shareone_client');

const args = process.argv.slice(2);
let action = null;
let email = null;
let code = null;
let apiKey = null;
let lang = null;

function usage() {
    console.error('Usage:');
    console.error('  node bind_account.js --send --email <email> [--api-key <key>] [--lang en|zh]');
    console.error('  node bind_account.js --verify --email <email> --code <6-digit-code> [--api-key <key>]');
}

function nextValue(index, flag) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
        console.error(`ERROR:MISSING_VALUE:${flag}`);
        usage();
        process.exit(1);
    }
    return value;
}

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--send') {
        action = 'send';
    } else if (args[i] === '--verify') {
        action = 'verify';
    } else if (args[i] === '--email') {
        email = nextValue(i, args[i]);
        i += 1;
    } else if (args[i] === '--code') {
        code = nextValue(i, args[i]);
        i += 1;
    } else if (args[i] === '--api-key') {
        apiKey = nextValue(i, args[i]);
        i += 1;
    } else if (args[i] === '--lang') {
        lang = nextValue(i, args[i]);
        i += 1;
    } else {
        console.error(`ERROR:UNKNOWN_ARGUMENT:${args[i]}`);
        usage();
        process.exit(1);
    }
}

if (!action) {
    console.error('ERROR:NO_ACTION');
    console.error('Specify --send or --verify.');
    usage();
    process.exit(1);
}

if (!email) {
    console.error('ERROR:MISSING_EMAIL');
    usage();
    process.exit(1);
}

function resolveApiKey() {
    const key = resolveDirectApiKey(apiKey);
    if (!key) {
        console.error('ERROR:KEY_NOT_FOUND');
        console.error('No API Key found. Run ensure_credentials.js first or pass --api-key.');
        process.exit(1);
    }
    return key;
}

async function sendCode() {
    const key = resolveApiKey();
    const payload = { email, api_key: key };
    if (lang) payload.lang = lang;

    try {
        await requestPublicShareOneJson('/api/v1/auth/email/send-code', {
            method: 'POST',
            authRequired: false,
        }, payload);
        console.log('CODE_SENT');
        console.log(`Verification code sent to ${email}`);
    } catch (error) {
        const detail = parseErrorDetail(error);
        if (error.statusCode === 429) {
            console.log('ERROR:RATE_LIMIT');
            console.log('Verification code sending rate limited. Please wait before retrying.');
        } else if (detail.includes('already') || detail.includes('已绑定') || detail.includes('已被')) {
            console.log('ERROR:EMAIL_ALREADY_LINKED');
            console.log(`Email ${email} is already linked to another account.`);
        } else if (detail.includes('cooldown') || detail.includes('冷却') || detail.includes('too soon')) {
            console.log('ERROR:COOLDOWN');
            console.log('Please wait 30 seconds before requesting another code.');
        } else {
            console.log(`ERROR:SEND_FAILED`);
            console.log(detail || error.message);
        }
        process.exit(1);
    }
}

async function verifyCode() {
    const key = resolveApiKey();

    if (!code) {
        console.error('ERROR:MISSING_CODE');
        console.error('--code is required for --verify.');
        usage();
        process.exit(1);
    }

    if (!/^\d{6}$/.test(code)) {
        console.error('ERROR:INVALID_CODE_FORMAT');
        console.error('Code must be exactly 6 digits.');
        process.exit(1);
    }

    try {
        const result = await requestPublicShareOneJson('/api/v1/auth/email/verify', {
            method: 'POST',
            authRequired: false,
        }, { email, code, api_key: key });
        console.log('BIND_SUCCESS');
        console.log(`Account bound to ${email}. API Key unchanged.`);
        if (result.username) {
            console.log(`USERNAME:${result.username}`);
        }
        console.log(`You can now log in at ${getBaseUrl()} with this email to manage your shares.`);
    } catch (error) {
        const detail = parseErrorDetail(error);
        if (error.statusCode === 404) {
            console.log('ERROR:CODE_EXPIRED');
            console.log('Verification code expired or not found. Please request a new one.');
        } else if (error.statusCode === 400 && (detail.includes('attempts') || detail.includes('尝试'))) {
            console.log('ERROR:TOO_MANY_ATTEMPTS');
            console.log('Too many incorrect attempts. Please request a new code.');
        } else if (error.statusCode === 400 && (detail.includes('already') || detail.includes('已绑定') || detail.includes('已被'))) {
            console.log('ERROR:EMAIL_ALREADY_LINKED');
            console.log(`Email ${email} is already linked to another account.`);
        } else if (error.statusCode === 400 && (detail.includes('invalid') || detail.includes('incorrect') || detail.includes('错误'))) {
            console.log('ERROR:INVALID_CODE');
            console.log('Incorrect verification code. Please check and try again.');
        } else if (error.statusCode === 404 && (detail.includes('api_key') || detail.includes('key'))) {
            console.log('ERROR:KEY_NOT_FOUND');
            console.log('The API Key is invalid or the guest account no longer exists.');
        } else {
            console.log('ERROR:VERIFY_FAILED');
            console.log(detail || error.message);
        }
        process.exit(1);
    }
}

function parseErrorDetail(error) {
    const text = String(error && error.responseText ? error.responseText : '');
    if (!text) return error.message || '';
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            const detail = parsed.detail;
            if (detail && typeof detail === 'object') {
                return String(detail.message || detail.code || '');
            }
            return String(detail || parsed.message || '');
        }
        return text;
    } catch (_) {
        return text;
    }
}

if (action === 'send') {
    sendCode().catch((error) => {
        console.error(`ERROR:${error.message}`);
        process.exit(1);
    });
} else {
    verifyCode().catch((error) => {
        console.error(`ERROR:${error.message}`);
        process.exit(1);
    });
}
