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

        function pickFirstIp(h) {
            if (!h) return '';
            var ip = String(h).split(',')[0].trim();
            // KRITIK: Azure x-forwarded-for IPv4'ü "1.2.3.4:56789" (port'lu) verir.
            // Meta port'lu string'i GEÇERSIZ IP sayıp sessizce düşürür → EMQ'da IP hiç
            // görünmez. Port'u ayıkla.
            var v6 = ip.match(/^\[(.+)\]:\d+$/);                 // [2001:db8::1]:443
            if (v6) return v6[1];
            if (ip.indexOf('.') !== -1 && (ip.match(/:/g) || []).length === 1) {
                return ip.split(':')[0];                          // 1.2.3.4:5678 -> 1.2.3.4
            }
            return ip;                                            // düz IPv4 veya bare IPv6
        }
        const clientIp =
            pickFirstIp(req.headers['x-forwarded-for']) ||
            pickFirstIp(req.headers['x-azure-clientip']) ||
            pickFirstIp(req.headers['x-azure-socketip']) ||
            pickFirstIp(req.headers['x-real-ip']) ||
            pickFirstIp(req.headers['client-ip']) ||
            pickFirstIp(req.headers['cf-connecting-ip']) ||
            '';

        // Browser event_time'ı tercih et — yoksa server time. Match kalitesi için kritik.
        // Meta 7 günden eski / 1 dk'dan ileri event_time'ı TÜM isteği reddeder. Bozuk cihaz
        // saati veya ms-ölçekli değer gelirse server zamanına düş (güvenli pencere: 6 gün).
        const now = Math.floor(Date.now() / 1000);
        let eventTime = Math.floor(Number(body.event_time) || 0);
        if (!eventTime || eventTime > now + 60 || eventTime < now - 6 * 24 * 3600) {
            eventTime = now;
        }

        // Sadece bilinen event'lere izin ver — anonim /api/capi endpoint'ine sahte 'Lead'
        // basıp optimizasyon sinyalini zehirlemeyi engeller. Yeni event eklersen buraya da ekle.
        const ALLOWED_EVENTS = ['PageView', 'Lead', 'AppStoreClick', 'GooglePlayClick', 'ViewContent'];
        const eventName = ALLOWED_EVENTS.indexOf(body.event_name) !== -1 ? body.event_name : null;
        if (!eventName) {
            context.log.warn('[CAPI] Rejected unknown event_name', { event_name: body.event_name });
            reply(400, { error: 'Unsupported event_name' });
            return;
        }

        const eventPayload = {
            event_name: eventName,
            event_time: eventTime,
            event_source_url: body.url || '',
            action_source: 'website',
            event_id: body.event_id || ('srv_' + Date.now()),
            user_data: {
                client_user_agent: req.headers['user-agent'] || ''
            }
        };

        // Boş/eksik IP GÖNDERME — Meta boş string'i geçersiz sayar; varsa ekle.
        if (clientIp) eventPayload.user_data.client_ip_address = clientIp;

        if (body.email) {
            const h = crypto.createHash('sha256').update(String(body.email).toLowerCase().trim()).digest('hex');
            eventPayload.user_data.em = [h];
        }
        // fbc/fbp Meta'ya HAM gider (hash'lenmez) ama formatı fb.N.timestamp.value olmalı —
        // bozuk cookie değerini Meta düşürür, göndermeyelim.
        const fbc = body.fbc && String(body.fbc);
        if (fbc && /^fb\.\d\.\d+\..+/.test(fbc)) eventPayload.user_data.fbc = fbc;
        const fbp = body.fbp && String(body.fbp);
        if (fbp && /^fb\.\d\.\d+\..+/.test(fbp)) eventPayload.user_data.fbp = fbp;

        // external_id — Meta'nın güçlü dedup anahtarı (Harici Kod). SHA-256'lı.
        // toLowerCase: browser Advanced Matching küçük harfe çevirip hash'liyor; aynı normalize.
        if (body.external_id) {
            const eidHash = crypto.createHash('sha256')
                .update(String(body.external_id).toLowerCase().trim())
                .digest('hex');
            eventPayload.user_data.external_id = [eidHash];
        }

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
