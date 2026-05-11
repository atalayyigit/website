const crypto = require('crypto');

module.exports = async function (context, req) {
    // CORS headers - lunasoft.com.tr'den çağrı kabul et
    context.res = {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    };

    // Preflight request
    if (req.method === 'OPTIONS') {
        context.res.status = 204;
        return;
    }

    const PIXEL_ID = process.env.META_PIXEL_ID;
    const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

    if (!PIXEL_ID || !ACCESS_TOKEN) {
        context.log.error('Missing META_PIXEL_ID or META_ACCESS_TOKEN env vars');
        context.res.status = 500;
        context.res.body = { error: 'Server configuration missing' };
        return;
    }

    const hash = (val) => val
        ? crypto.createHash('sha256').update(String(val).toLowerCase().trim()).digest('hex')
        : undefined;

    const body = req.body || {};
    
    // Gerçek IP'yi al (Azure proxy arkasında)
    const clientIp = (req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() || req.headers['client-ip'] || '';

    const eventPayload = {
        event_name: body.event_name || 'PageView',
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: body.url,
        action_source: 'website',
        event_id: body.event_id,
        user_data: {
            client_ip_address: clientIp,
            client_user_agent: req.headers['user-agent'] || ''
        }
    };

    // Opsiyonel: email varsa hash'le ekle
    if (body.email) {
        eventPayload.user_data.em = [hash(body.email)];
    }

    // Facebook cookie'leri (varsa) - match quality için kritik
    if (body.fbc) eventPayload.user_data.fbc = body.fbc;
    if (body.fbp) eventPayload.user_data.fbp = body.fbp;

    const requestBody = { data: [eventPayload] };

    // Test event code (geliştirme için)
    if (body.test_event_code) {
        requestBody.test_event_code = body.test_event_code;
    }

    try {
        const response = await fetch(
            `https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            }
        );

        const result = await response.json();
        
        if (!response.ok) {
            context.log.error('Meta CAPI error:', result);
            context.res.status = response.status;
            context.res.body = result;
            return;
        }

        context.res.status = 200;
        context.res.body = result;
    } catch (err) {
        context.log.error('CAPI request failed:', err.message);
        context.res.status = 500;
        context.res.body = { error: err.message };
    }
};
