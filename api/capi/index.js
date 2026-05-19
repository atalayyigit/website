const crypto = require('crypto');
const https = require('https');

function safeJson(obj) {
    try { return JSON.stringify(obj); } catch (e) { return '{}'; }
}

function postJson(host, path, payload) {
    return new Promise((resolve) => {
        const data = safeJson(payload);
        const options = {
            host: host,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            },
            timeout: 8000
        };

        const req = https.request(options, (res) => {
            let chunks = '';
            res.on('data', (c) => { chunks += c; });
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(chunks); } catch (e) { parsed = { raw: chunks }; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('Request timeout'));
        });
        req.on('error', (err) => {
            resolve({ status: 0, body: { error: err.message } });
        });

        req.write(data);
        req.end();
    });
}

module.exports = async function (context, req) {
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    function reply(status, body) {
        context.res = {
            status: status,
            headers: corsHeaders,
            body: body
        };
    }

    try {
        if (req.method === 'OPTIONS') {
            reply(204, '');
            return;
        }

        const PIXEL_ID = process.env.META_PIXEL_ID;
        const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

        if (!PIXEL_ID || !ACCESS_TOKEN) {
            context.log.error('[CAPI] Missing env vars', { hasPixelId: !!PIXEL_ID, hasToken: !!ACCESS_TOKEN });
            reply(500, { error: 'Server configuration missing', detail: 'META_PIXEL_ID or META_ACCESS_TOKEN not set' });
            return;
        }

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) { body = {}; }
        }
        body = body || {};

        const clientIp = (req.headers['x-forwarded-for'] || '')
            .split(',')[0]
            .trim() || req.headers['client-ip'] || '';

        const eventPayload = {
            event_name: body.event_name || 'PageView',
            event_time: Math.floor(Date.now() / 1000),
            event_source_url: body.url || '',
            action_source: 'website',
            event_id: body.event_id || ('srv_' + Date.now()),
            user_data: {
                client_ip_address: clientIp,
                client_user_agent: req.headers['user-agent'] || ''
            }
        };

        if (body.email) {
            const h = crypto.createHash('sha256').update(String(body.email).toLowerCase().trim()).digest('hex');
            eventPayload.user_data.em = [h];
        }
        if (body.fbc) eventPayload.user_data.fbc = body.fbc;
        if (body.fbp) eventPayload.user_data.fbp = body.fbp;

        if (body.custom_data && typeof body.custom_data === 'object' && Object.keys(body.custom_data).length > 0) {
            eventPayload.custom_data = body.custom_data;
        }

        const requestBody = { data: [eventPayload] };
        if (body.test_event_code) {
            requestBody.test_event_code = body.test_event_code;
        }

        context.log('[CAPI] Sending event', {
            event_name: eventPayload.event_name,
            event_id: eventPayload.event_id,
            test_event_code: body.test_event_code || null
        });

        const path = `/v18.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
        const result = await postJson('graph.facebook.com', path, requestBody);

        if (result.status >= 200 && result.status < 300) {
            context.log('[CAPI] Success', result.body);
            reply(200, result.body);
        } else {
            context.log.error('[CAPI] Meta error', { status: result.status, body: result.body });
            reply(result.status || 502, { error: 'Meta CAPI error', meta: result.body });
        }
    } catch (err) {
        context.log.error('[CAPI] Unhandled error', err && err.stack ? err.stack : err);
        reply(500, { error: 'Unhandled exception', message: (err && err.message) || String(err) });
    }
};
