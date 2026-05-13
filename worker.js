// BCFSA + Anthropic Proxy — Cloudflare Worker
// Routes:
//   GET  /?lic=187439              → scrape BCFSA licencee + brokerage (no API key needed)
//   GET  /brokerage-reps?lic=X025017 → scrape all reps for a brokerage (no API key needed)
//   POST /ai                       → proxy to Anthropic API (requires ANTHROPIC_API_KEY)
//
// REQUIRED: Set environment variable in Cloudflare dashboard:
//   Worker → Settings → Variables and Secrets
//   Name: ANTHROPIC_API_KEY   Value: sk-ant-...
//
// DEPLOY: paste this file into the Cloudflare Worker editor and click Save & Deploy

const ALLOWED_ORIGINS = [
  'https://app.neurata.ai',
  'https://neurata.ai',
  'https://www.neurata.ai',
  'https://dev.app.neurata.ai',   // dev environment (original)
  'https://appdev.neurata.ai',    // dev environment (actual)
  'http://localhost:3000',         // local development
  'http://localhost:5173',         // Vite local dev
];

function getCORS(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json',
  };
}

// For backwards compat — replaced by getCORS(request) calls below
// Will be overwritten per-request at handler entry
let CORS = {
  'Access-Control-Allow-Origin': 'https://app.neurata.ai',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Dummy licences for internal testing — bypasses BCFSA lookup
const DUMMY_LICENCES = {
  'RE696969': {
    name: 'Jeremy McCarron',
    knownAs: 'Jeremy',
    licensedAs: 'Managing Broker',
    licensedFor: 'Strata Management',
    licenceStatus: 'Active',
    licenceExpiry: '2026-12-31',
    businessName: 'Associated Property Management (2001) Ltd.',
    businessAddress: '123 Test St, Vancouver BC V6B 1A1',
    businessPhone: '604-555-0100',
    businessLicence: 'X025017',
    brkName: 'Associated Property Management (2001) Ltd.',
    brkAddress: '123 Test St, Vancouver BC V6B 1A1',
    brkPhone: '604-555-0100',
    brkStatus: 'Active',
    brkExpiry: '2026-12-31',
    _isDummy: true
  }
};

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event).catch(err => {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }));
});

async function handleRequest(request, event) {
  // Set CORS dynamically based on request origin — supports prod, dev, and localhost
  CORS = getCORS(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: getCORS(request) });
  }

  const url = new URL(request.url);

  // ── POST /ai → proxy to Anthropic ──────────────────────────────────
  // ── /setup-user — create user profile after email confirmation ──────────
  if (request.method === 'POST' && url.pathname === '/setup-user') {
    if (typeof SUPABASE_SERVICE_KEY === 'undefined' || !SUPABASE_SERVICE_KEY) {
      return new Response(JSON.stringify({ error: 'Service key not configured' }), { status: 500, headers: CORS });
    }
    let body;
    try { body = await request.json(); } catch(e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }
    const { userId, dn, email, lic, role, brkLic, scId } = body;
    if (!userId || !email) {
      return new Response(JSON.stringify({ error: 'Missing userId or email' }), { status: 400, headers: CORS });
    }
    const supaUrl = 'https://sozghbobflcjrfsmewxv.supabase.co/rest/v1';
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'resolution=merge-duplicates'
    };
    try {
      // Write user profile
      const userResp = await fetch(supaUrl + '/users', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: userId, full_name: dn, email, bcfsa_lic: lic,
          role: role || 'Representative', brokerage_id: brkLic
        })
      });
      if (!userResp.ok) {
        const err = await userResp.text();
        return new Response(JSON.stringify({ error: 'User insert failed: ' + err }), { status: 500, headers: CORS });
      }
      // Write sc_users
      if (scId) {
        await fetch(supaUrl + '/sc_users', {
          method: 'POST',
          headers,
          body: JSON.stringify({ sc_id: scId, user_id: userId, access_type: 'rep' })
        });
        // Write reps
        await fetch(supaUrl + '/reps', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            brokerage_id: brkLic, bcfsa_lic: lic,
            name: dn, sc_ids: JSON.stringify([scId])
          })
        });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  if (request.method === 'POST' && url.pathname === '/ai') {
    if (typeof ANTHROPIC_API_KEY === 'undefined' || !ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in worker environment variables' }), {
        status: 500, headers: CORS
      });
    }

    let body;
    try { body = await request.text(); }
    catch (e) { return new Response(JSON.stringify({ error: 'Failed to read body' }), { status: 400, headers: CORS }); }

    // Extract betas array and convert to header
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) { parsed = null; }

    // ── AI Usage limits (adjust these variables to change limits) ──
    const AI_LIMITS = {
      ss_local:  200,  // queries per SC per month (paid)
      ss_global: 400,  // queries per brokerage per month (paid)
      mm_ai:     100,  // MM AI calls per SC per month
      ss_trial:  10,   // SS queries per SC during free trial
    };
    const AI_WARN_PCT = 0.80; // warn at 80%

    // Extract usage context from request body
    const usageType    = parsed && parsed._usageType    || null;
    const brokerageId  = parsed && parsed._brokerageId  || null;
    const scId         = parsed && parsed._scId         || null;
    const userId       = parsed && parsed._userId       || null;

    // Remove internal fields before sending to Anthropic
    if (parsed) {
      delete parsed._usageType;
      delete parsed._brokerageId;
      delete parsed._scId;
      delete parsed._userId;
      body = JSON.stringify(parsed);
    }

    const parseTypes = ['parse_plan', 'parse_agenda', 'parse_minutes'];
    const isParseType = parseTypes.indexOf(usageType) >= 0;

    // Check usage limits if context provided (not for parse types)
    if (usageType && (brokerageId || scId) && SUPABASE_URL && SUPABASE_SERVICE_KEY && !isParseType) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const limit = AI_LIMITS[usageType] || 100;

      // Query current month usage
      const filterField = (usageType === 'ss_global') ? 'brokerage_id' : 'sc_id';
      const filterVal   = (usageType === 'ss_global') ? brokerageId : scId;

      try {
        const usageResp = await fetch(
          `${SUPABASE_URL}/rest/v1/ai_usage?usage_type=eq.${usageType}&${filterField}=eq.${encodeURIComponent(filterVal)}&created_at=gte.${monthStart}&select=id`,
          { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
        );
        const usageData = await usageResp.json();
        const currentCount = Array.isArray(usageData) ? usageData.length : 0;
        const pct = currentCount / limit;

        if (pct >= 1.0) {
          // Hard stop
          return new Response(JSON.stringify({
            error: 'usage_limit_exceeded',
            message: 'Monthly AI usage limit reached for this ' + (usageType === 'ss_global' ? 'brokerage' : 'strata corporation') + '. Please contact support@neurata.ai.',
            usageType, currentCount, limit
          }), { status: 429, headers: CORS });
        }

        // Soft warn — include warning in response metadata (app will surface it)
        const warnUser = pct >= AI_WARN_PCT;

        // Proceed with Anthropic call, then log usage
        const anthropicHeaders = {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        };
        if (parsed && parsed.betas && Array.isArray(parsed.betas) && parsed.betas.length > 0) {
          anthropicHeaders['anthropic-beta'] = parsed.betas.join(',');
        }

        let resp;
        try {
          let lastR;
          for (let attempt = 1; attempt <= 3; attempt++) {
            lastR = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST', headers: anthropicHeaders, body: body,
            });
            if (lastR.status !== 429) break;
            if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
          }
          resp = lastR;
        } catch (e) {
          return new Response(JSON.stringify({ error: 'Failed to reach Anthropic: ' + e.message }), { status: 502, headers: CORS });
        }

        const respText = await resp.text();
        let respParsed;
        try { respParsed = JSON.parse(respText); } catch(e) { respParsed = null; }

        // Log usage to Supabase
        const inputTokens  = respParsed && respParsed.usage && respParsed.usage.input_tokens  || 0;
        const outputTokens = respParsed && respParsed.usage && respParsed.usage.output_tokens || 0;
        if (usageType && (brokerageId || scId) && SUPABASE_URL && SUPABASE_SERVICE_KEY && !isParseType) {
          try {
            await fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                brokerage_id: brokerageId, sc_id: scId, user_id: userId,
                usage_type: usageType, model: parsed && parsed.model || 'unknown',
                input_tokens: inputTokens, output_tokens: outputTokens
              })
            });
          } catch(e) { console.error('[ai_usage] error:', e); }
        }

        // Add warning to response if near limit
        if (warnUser && respParsed) {
          respParsed._usageWarning = {
            currentCount: currentCount + 1, limit, pct: Math.round((currentCount+1)/limit*100),
            message: 'You have used ' + Math.round((currentCount+1)/limit*100) + '% of your monthly AI limit for this ' + (usageType === 'ss_global' ? 'brokerage' : 'strata corporation') + '.'
          };
          return new Response(JSON.stringify(respParsed), { status: resp.status, headers: CORS });
        }

        return new Response(respText, { status: resp.status, headers: CORS });

      } catch(e) {
        // If usage check fails, proceed anyway (don't block the user)
        console.error('Usage check error:', e);
      }
    }

    const anthropicHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    };

    if (parsed && parsed.betas && Array.isArray(parsed.betas) && parsed.betas.length > 0) {
      anthropicHeaders['anthropic-beta'] = parsed.betas.join(',');
      delete parsed.betas;
      body = JSON.stringify(parsed);
    }

    let resp;
    try {
      // Retry up to 3 times on Anthropic 429 with exponential backoff
      let lastResp;
      for (let attempt = 1; attempt <= 3; attempt++) {
        lastResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: anthropicHeaders,
          body: body,
        });
        if (lastResp.status !== 429) break;
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000)); // 2s, 4s
      }
      resp = lastResp;
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Failed to reach Anthropic: ' + e.message }), { status: 502, headers: CORS });
    }

    const data = await resp.text();

    // Log parse-type calls (no limit enforcement, just tracking)
    if (isParseType && usageType && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      let parsedResp; try { parsedResp = JSON.parse(data); } catch(e) { parsedResp = null; }
      const inputTokens  = parsedResp && parsedResp.usage && parsedResp.usage.input_tokens  || 0;
      const outputTokens = parsedResp && parsedResp.usage && parsedResp.usage.output_tokens || 0;
      fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ brokerage_id: brokerageId, sc_id: scId, user_id: userId, usage_type: usageType, model: parsed && parsed.model || 'unknown', input_tokens: inputTokens, output_tokens: outputTokens })
      }).catch(() => {});
    }

    return new Response(data, { status: resp.status, headers: CORS });
  }

  // ── GET /stripe/config → return publishable key matching current mode ────
  if (request.method === 'GET' && url.pathname === '/stripe/config') {
    return new Response(JSON.stringify({
      publishableKey: STRIPE_PUBLISHABLE_KEY
    }), { headers: CORS });
  }

  // ── POST /extract-doc-text → fetch PDF + multi-pass extract + classify server-side ──
  // Runs entirely in the worker — no client-side timeout risk.
  // Returns { text, docType } when complete.
  if (request.method === 'POST' && url.pathname === '/extract-doc-text') {
    let body;
    try { body = await request.json(); } catch(e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }
    const { storagePath, brokerageId, scId, userId } = body;
    if (!storagePath) return new Response(JSON.stringify({ error: 'Missing storagePath' }), { status: 400, headers: CORS });
    if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), { status: 500, headers: CORS });

    // Step 1: fetch PDF from Supabase Storage
    const storageUrl = `${SUPABASE_URL}/storage/v1/object/neurata-documents/${storagePath}`;
    let b64;
    try {
      const r = await fetch(storageUrl, {
        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'apikey': SUPABASE_SERVICE_KEY }
      });
      if (!r.ok) {
        const t = await r.text();
        return new Response(JSON.stringify({ error: 'Storage fetch failed: ' + r.status, detail: t.slice(0,200) }), { status: 502, headers: CORS });
      }
      const buffer = await r.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      b64 = btoa(binary);
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Storage fetch error: ' + e.message }), { status: 500, headers: CORS });
    }

    // Step 2: multi-pass text extraction (up to 5 passes x 8000 tokens)
    const anthropicHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25'
    };

    async function extractPass(accumulated, pass) {
      if (pass > 5) return accumulated;
      const isFirst = pass === 1;
      const prompt = isFirst
        ? 'Extract the COMPLETE text content of this document from beginning to end. Return only the extracted text, preserving all structure (sections, headings, numbered items, schedules). Do not summarize — return the actual text. Do not stop until you have extracted everything.'
        : 'Continue extracting the text of this document. You previously extracted up to:\n\n---\n' + accumulated.slice(-500) + '\n---\n\nContinue from exactly where that left off. Do not repeat any text already extracted. Extract everything remaining to the end of the document.';

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: anthropicHeaders,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          messages: [{ role: 'user', content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
            { type: 'text', text: prompt }
          ]}]
        })
      });
      const d = await resp.json();
      const chunk = (d.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('').trim();
      if (!chunk) return accumulated;
      const full = accumulated ? accumulated + '\n' + chunk : chunk;
      if (d.stop_reason === 'max_tokens') return extractPass(full, pass + 1);
      return full;
    }

    let extractedText = '';
    try {
      extractedText = await extractPass('', 1);
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Extraction failed: ' + e.message }), { status: 500, headers: CORS });
    }

    if (!extractedText) {
      return new Response(JSON.stringify({ error: 'No text extracted from document' }), { status: 422, headers: CORS });
    }

    // Step 3: classify document type
    let docType = 'other';
    try {
      const cr = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { ...anthropicHeaders, 'anthropic-beta': undefined, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 20,
          messages: [{ role: 'user', content:
            'Classify this BC strata document. Return ONLY one word from this exact list: bylaws, strata-plan, minutes, financial, correspondence, contract, template, policy, disclosure, other\n\nDocument sample:\n' + extractedText.slice(0, 2000)
          }]
        })
      });
      const cd = await cr.json();
      const raw = (cd.content||[]).filter(b=>b.type==='text').map(b=>b.text||'').join('').trim().toLowerCase();
      const valid = ['bylaws','strata-plan','minutes','financial','correspondence','contract','template','policy','disclosure','other'];
      if (valid.includes(raw)) docType = raw;
    } catch(e) { /* classification failed — use 'other' */ }

    // Step 4: save to Supabase documents table
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY && body.docId) {
      await fetch(`${SUPABASE_URL}/rest/v1/documents?id=eq.${encodeURIComponent(body.docId)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ document_text: extractedText, doc_type: docType })
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ text: extractedText, docType }), { headers: CORS });
  }

  // ── POST /fetch-pdf → fetch a PDF from Supabase Storage and return as base64 ──
  // Uses service key for authenticated access — bucket can remain private
  if (request.method === 'POST' && url.pathname === '/fetch-pdf') {
    let body;
    try { body = await request.json(); } catch(e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }
    const { storagePath } = body;
    if (!storagePath) return new Response(JSON.stringify({ error: 'Missing storagePath' }), { status: 400, headers: CORS });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return new Response(JSON.stringify({ error: 'Supabase not configured' }), { status: 500, headers: CORS });
    }
    // Fetch from Supabase Storage API using service key
    const storageUrl = `${SUPABASE_URL}/storage/v1/object/neurata-documents/${storagePath}`;
    try {
      const r = await fetch(storageUrl, {
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY
        }
      });
      if (!r.ok) {
        const errText = await r.text();
        return new Response(JSON.stringify({ error: 'Fetch failed: ' + r.status, detail: errText.slice(0,200) }), { status: 502, headers: CORS });
      }
      const buffer = await r.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // Convert to base64
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const b64 = btoa(binary);
      return new Response(JSON.stringify({ b64 }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  const STRIPE_API = 'https://api.stripe.com/v1';
  const STRIPE_PRICES = {
    mm:       'price_1TRJQ9DoAu5fJf3RnzanQfPU',
    local_ss: 'price_1TRJScDoAu5fJf3R2vQLLuv2',
    global_ss:'price_1TRJP6DoAu5fJf3RrSp5CbMN'
  };
  const GST_RATE = 0.05; // 5% GST

  async function stripePost(path, params) {
    const body = new URLSearchParams(params).toString();
    const r = await fetch(STRIPE_API + path, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2023-10-16'
      },
      body
    });
    return r.json();
  }

  async function stripeGet(path) {
    const r = await fetch(STRIPE_API + path, {
      headers: {
        'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
        'Stripe-Version': '2023-10-16'
      }
    });
    return r.json();
  }

  // Calculate prorated days from today to end of month
  function proratedDays() {
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return endOfMonth.getDate() - now.getDate() + 1;
  }

  function daysInMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  }

  // First of next month as Unix timestamp
  function nextMonthStart() {
    const now = new Date();
    return Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() / 1000);
  }

  // ── GET /stripe/invoices?customerId=... → fetch invoice history from Stripe ──
  if (request.method === 'GET' && url.pathname === '/stripe/invoices') {
    const customerId = url.searchParams.get('customerId');
    const createdGte = url.searchParams.get('created_gte'); // unix timestamp
    const createdLte = url.searchParams.get('created_lte');
    if (!customerId) return new Response(JSON.stringify({ error: 'Missing customerId' }), { status: 400, headers: CORS });
    try {
      // Build invoice query — paid only. This is a statements view, not a payment collection view.
      let invoiceQuery = '/invoices?customer=' + encodeURIComponent(customerId) + '&limit=100&status=paid';
      if (createdGte) invoiceQuery += '&created[gte]=' + createdGte;
      if (createdLte) invoiceQuery += '&created[lte]=' + createdLte;

      // Fetch invoices only — no need for customer email
      const result = await stripeGet(invoiceQuery);
      if (result.error) throw new Error(result.error.message);

      const invoices = (result.data || []).map(inv => ({
        id:          inv.id,
        date:        new Date(inv.created * 1000).toISOString().slice(0, 10),
        amount:      inv.amount_paid,
        currency:    inv.currency,
        status:      'paid',
        scPlan:      inv.metadata && inv.metadata.sc_plan || '',
        description: inv.description || '',
        pdfUrl:      inv.invoice_pdf || '',
        hostedUrl:   inv.hosted_invoice_url || ''
      }));

      return new Response(JSON.stringify({ invoices }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /stripe/cancel-sc → schedule cancellation at anniversary date ──────
  if (request.method === 'POST' && url.pathname === '/stripe/cancel-sc') {
    let body;
    try { body = await request.json(); } catch(e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }
    const { subscriptionId, cancelAt, scPlan } = body;
    if (!subscriptionId || !cancelAt) {
      return new Response(JSON.stringify({ error: 'Missing subscriptionId or cancelAt' }), { status: 400, headers: CORS });
    }
    try {
      const result = await stripePost('/subscriptions/' + subscriptionId, {
        cancel_at: String(Math.floor(cancelAt / 1000)),
        proration_behavior: 'create_prorations'
      });
      if (result.error) throw new Error(result.error.message);
      if (scPlan && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/strata_corps?plan_number=eq.${encodeURIComponent(scPlan)}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mm_pending_cancel: true })
        });
      }
      return new Response(JSON.stringify({ ok: true, cancelAt: result.cancel_at }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /stripe/reactivate-sc → remove scheduled cancellation ───────────
  if (request.method === 'POST' && url.pathname === '/stripe/reactivate-sc') {
    let body;
    try { body = await request.json(); } catch(e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }
    const { subscriptionId, scPlan } = body;
    if (!subscriptionId) return new Response(JSON.stringify({ error: 'Missing subscriptionId' }), { status: 400, headers: CORS });
    try {
      const result = await stripePost('/subscriptions/' + subscriptionId, {
        cancel_at: '',
        proration_behavior: 'none'
      });
      if (result.error) throw new Error(result.error.message);
      if (scPlan && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/strata_corps?plan_number=eq.${encodeURIComponent(scPlan)}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mm_pending_cancel: false })
        });
      }
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /stripe/create-customer ─────────────────────────────────────────
  if (request.method === 'POST' && url.pathname === '/stripe/create-customer') {
    let body;
    try { body = await request.json(); } catch(e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }
    const { brkLic, name, email, phone, address, country, metadata } = body;
    if (!brkLic || !name || !email) {
      return new Response(JSON.stringify({ error: 'Missing brkLic, name, or email' }), { status: 400, headers: CORS });
    }
    try {
      // 1. Check brokerage's own stripe_customer_id first — always reuse if exists
      const brkResp = await fetch(`${SUPABASE_URL}/rest/v1/brokerages?bcfsa_lic=eq.${encodeURIComponent(brkLic)}&select=stripe_customer_id`, {
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
      });
      const brkData = await brkResp.json();
      if (brkData && brkData[0] && brkData[0].stripe_customer_id) {
        // Update existing customer with latest details
        await stripePost('/customers/' + brkData[0].stripe_customer_id, {
          name: name,
          email: email,
          phone: phone || '',
          'address[line1]':       address || '',
          'address[country]':     country || 'CA',
          'preferred_locales[]':  'en-CA'
        });
        return new Response(JSON.stringify({ customerId: brkData[0].stripe_customer_id }), { headers: CORS });
      }

      // 2. Check Stripe by email
      const existing = await stripeGet('/customers?email=' + encodeURIComponent(email) + '&limit=1');
      if (existing.data && existing.data.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/brokerages?bcfsa_lic=eq.${encodeURIComponent(brkLic)}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ stripe_customer_id: existing.data[0].id })
        });
        return new Response(JSON.stringify({ customerId: existing.data[0].id }), { headers: CORS });
      }

      // 3. Create new customer with full details
      const customerParams = {
        email,
        name,
        phone:                  phone || '',
        'address[line1]':       address || '',
        'address[country]':     country || 'CA',
        'metadata[brokerage_id]': brkLic,
        'preferred_locales[]':  'en-CA'
      };
      if (metadata) {
        Object.keys(metadata).forEach(function(k) {
          customerParams['metadata[' + k + ']'] = metadata[k] || '';
        });
      }
      const customer = await stripePost('/customers', customerParams);
      if (customer.error) throw new Error(customer.error.message);
      await fetch(`${SUPABASE_URL}/rest/v1/brokerages?bcfsa_lic=eq.${encodeURIComponent(brkLic)}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripe_customer_id: customer.id })
      });
      return new Response(JSON.stringify({ customerId: customer.id }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /stripe/set-default-payment ─────────────────────────────────────
  if (request.method === 'POST' && url.pathname === '/stripe/set-default-payment') {
    let body;
    try { body = await request.json(); } catch(e) { return new Response(JSON.stringify({error:'Invalid JSON'}), {status:400,headers:CORS}); }
    const { customerId, paymentMethodId } = body;
    if (!customerId || !paymentMethodId) return new Response(JSON.stringify({error:'Missing fields'}), {status:400,headers:CORS});
    try {
      await stripePost('/customers/' + customerId, {
        'invoice_settings[default_payment_method]': paymentMethodId
      });
      await stripePost('/payment_methods/' + paymentMethodId + '/attach', { customer: customerId });
      return new Response(JSON.stringify({ok:true}), {headers:CORS});
    } catch(e) {
      return new Response(JSON.stringify({error:e.message}), {status:500,headers:CORS});
    }
  }

  // ── POST /stripe/setup-intent ─────────────────────────────────────────────
  // Returns a SetupIntent client_secret for collecting payment method
  if (request.method === 'POST' && url.pathname === '/stripe/setup-intent') {
    let body;
    try { body = await request.json(); } catch(e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }
    const { customerId, paymentType } = body; // paymentType: 'card' or 'acss_debit'
    if (!customerId) return new Response(JSON.stringify({ error: 'Missing customerId' }), { status: 400, headers: CORS });
    try {
      const params = {
        customer: customerId,
        'payment_method_types[]': paymentType === 'acss_debit' ? 'acss_debit' : 'card',
        usage: 'off_session'
      };
      if (paymentType === 'acss_debit') {
        params['payment_method_options[acss_debit][currency]'] = 'cad';
        params['payment_method_options[acss_debit][mandate_options][payment_schedule]'] = 'combined';
        params['payment_method_options[acss_debit][mandate_options][transaction_type]'] = 'business';
        params['payment_method_options[acss_debit][mandate_options][interval_description]'] = 'First of each month';
        params['payment_method_options[acss_debit][verification_method]'] = 'microdeposits';
      }
      const intent = await stripePost('/setup_intents', params);
      if (intent.error) throw new Error(intent.error.message);
      return new Response(JSON.stringify({ clientSecret: intent.client_secret, intentId: intent.id }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /stripe/activate-sc ──────────────────────────────────────────────
  // Activate MM + SS for one SC. Creates or updates subscription.
  if (request.method === 'POST' && url.pathname === '/stripe/activate-sc') {
    let body;
    try { body = await request.json(); } catch(e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }
    const { customerId, brkLic, scPlan, lots, ssTier, paymentMethodId } = body;
    if (!customerId || !scPlan || !lots || !ssTier) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: CORS });
    }
    try {
      // Set default payment method on customer
      if (paymentMethodId) {
        await stripePost('/customers/' + customerId, { invoice_settings: { default_payment_method: paymentMethodId } });
      }

      // Calculate proration for current month
      const prorateDays = proratedDays();
      const totalDays = daysInMonth();
      const mmMonthly = 3900; // CA$39.00 in cents
      const ssRatePerLot = ssTier === 'global' ? 249 : 149; // cents
      const ssMonthly = ssRatePerLot * lots;
      const totalMonthly = mmMonthly + ssMonthly;
      const proratedAmount = Math.round(totalMonthly * prorateDays / totalDays);
      const gstAmount = Math.round(proratedAmount * GST_RATE);

      // Charge prorated first payment immediately
      if (proratedAmount > 0) {
        const invoice = await stripePost('/invoices', {
          customer: customerId,
          currency: 'cad',
          auto_advance: 'true',
          collection_method: 'charge_automatically',
          'metadata[type]': 'proration',
          'metadata[sc_plan]': scPlan,
          'metadata[brk_lic]': brkLic,
          description: `Neurata activation — ${scPlan} (${prorateDays}/${totalDays} days) + GST`
        });
        // Add line items
        await stripePost('/invoiceitems', {
          customer: customerId,
          invoice: invoice.id,
          amount: proratedAmount,
          currency: 'cad',
          description: `Meeting Mode + ${ssTier === 'global' ? 'Global' : 'Local'} StrataSphere — ${scPlan} (${lots} lots, ${prorateDays}/${totalDays} days)`
        });
        await stripePost('/invoiceitems', {
          customer: customerId,
          invoice: invoice.id,
          amount: gstAmount,
          currency: 'cad',
          description: 'GST (5%)'
        });
        // Finalize and pay
        await stripePost('/invoices/' + invoice.id + '/finalize', {});
        await stripePost('/invoices/' + invoice.id + '/pay', {});
      }

      // Create recurring subscription starting 1st of next month
      const ssPriceId = ssTier === 'global' ? STRIPE_PRICES.global_ss : STRIPE_PRICES.local_ss;
      const subscription = await stripePost('/subscriptions', {
        customer: customerId,
        'items[0][price]': STRIPE_PRICES.mm,
        'items[0][quantity]': 1,
        'items[1][price]': ssPriceId,
        'items[1][quantity]': lots,
        billing_cycle_anchor: nextMonthStart(),
        proration_behavior: 'none',
        currency: 'cad',
        'metadata[sc_plan]': scPlan,
        'metadata[brk_lic]': brkLic,
        'metadata[ss_tier]': ssTier,
        'automatic_tax[enabled]': 'true'
      });

      if (subscription.error) throw new Error(subscription.error.message);

      // Save subscription ID to Supabase
      await fetch(`${SUPABASE_URL}/rest/v1/strata_corps?plan_number=eq.${encodeURIComponent(scPlan)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          stripe_subscription_id: subscription.id,
          is_subscribed: true,
          mm_activated_at: new Date().toISOString(),
          ss_tier: ssTier
        })
      });

      return new Response(JSON.stringify({
        subscriptionId: subscription.id,
        proratedAmount: proratedAmount,
        monthlyAmount: totalMonthly,
        gst: gstAmount
      }), { headers: CORS });

    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /stripe/schedule-downgrade → swap SS price to local at period end ─
  if (request.method === 'POST' && url.pathname === '/stripe/schedule-downgrade') {
    let body;
    try { body = await request.json(); } catch(e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS });
    }
    const { subscriptionId, scPlan, brkLic, newTier } = body;
    if (!subscriptionId || !newTier) {
      return new Response(JSON.stringify({ error: 'Missing subscriptionId or newTier' }), { status: 400, headers: CORS });
    }
    try {
      // Fetch the current subscription to find the SS line-item id
      const sub = await stripeGet('/subscriptions/' + subscriptionId);
      if (sub.error) throw new Error(sub.error.message);

      const items = (sub.items && sub.items.data) || [];
      // Find the SS item — whichever price is NOT the flat MM price
      const ssItem = items.find(function(it) {
        return it.price && it.price.id !== STRIPE_PRICES.mm;
      });
      if (!ssItem) throw new Error('Could not find StrataSphere line item on subscription.');

      const newPriceId = STRIPE_PRICES.local_ss;
      const lots = ssItem.quantity || 1;

      // Schedule the price swap at the end of the current period (no immediate proration)
      const result = await stripePost('/subscriptions/' + subscriptionId, {
        proration_behavior: 'none',
        'items[0][id]':       ssItem.id,
        'items[0][price]':    newPriceId,
        'items[0][quantity]': lots,
        'metadata[ss_tier]':  'local'
      });
      if (result.error) throw new Error(result.error.message);

      // Mirror pending downgrade flag in Supabase
      if (scPlan && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/strata_corps?plan_number=eq.${encodeURIComponent(scPlan)}`, {
          method: 'PATCH',
          headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ss_pending_downgrade: 'local' })
        });
      }

      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /stripe/webhook ──────────────────────────────────────────────────
  if (request.method === 'POST' && url.pathname === '/stripe/webhook') {
    const sig = request.headers.get('stripe-signature');
    const rawBody = await request.text();

    // Verify webhook signature — reject if secret not configured or sig missing
    if (!STRIPE_WEBHOOK_SECRET || !sig) {
      return new Response('Webhook secret not configured or missing signature', { status: 400 });
    }
    if (STRIPE_WEBHOOK_SECRET && sig) {
      try {
        const parts = Object.fromEntries(sig.split(',').map(p => p.split('=')));
        const timestamp = parts.t;
        const expectedSig = parts.v1;
        const payload = timestamp + '.' + rawBody;
        const key = await crypto.subtle.importKey(
          'raw',
          new TextEncoder().encode(STRIPE_WEBHOOK_SECRET),
          { name: 'HMAC', hash: 'SHA-256' },
          false, ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
        const hex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2,'0')).join('');
        if (hex !== expectedSig) {
          return new Response('Invalid signature', { status: 400 });
        }
        // Reject events older than 5 minutes
        if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) {
          return new Response('Timestamp too old', { status: 400 });
        }
      } catch(e) {
        return new Response('Signature verification failed', { status: 400 });
      }
    }
    let event;
    try { event = JSON.parse(rawBody); } catch(e) {
      return new Response('Invalid JSON', { status: 400 });
    }
    // Handle events
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const scPlan = invoice.metadata && invoice.metadata.sc_plan;
      const brkLic = invoice.metadata && invoice.metadata.brk_lic;

      // Record invoice in Supabase
      if (scPlan && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/invoices`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            brokerage_id: brkLic,
            sc_id: scPlan,
            stripe_invoice_id: invoice.id,
            amount: invoice.amount_paid,
            currency: invoice.currency,
            status: 'paid',
            paid_at: new Date(invoice.status_transitions.paid_at * 1000).toISOString()
          })
        });
      }
      // Note: Stripe sends its own receipt email automatically — no duplicate needed here.
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const scPlan = invoice.metadata && invoice.metadata.sc_plan;
      const brkLic = invoice.metadata && invoice.metadata.brk_lic;
      // Notify MB via email
      if (brkLic && MAILTRAP_API_KEY) {
        // Get brokerage email from Supabase
        try {
          const br = await fetch(`${SUPABASE_URL}/rest/v1/brokerages?bcfsa_lic=eq.${encodeURIComponent(brkLic)}&select=email,name`, {
            headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
          });
          const brData = await br.json();
          const brokerage = brData && brData[0];
          if (brokerage && brokerage.email) {
            await fetch('https://send.api.mailtrap.io/api/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (MAILTRAP_SEND_KEY || MAILTRAP_API_KEY) },
              body: JSON.stringify({
                from: { email: 'info@neurata.ai', name: 'Neurata' },
                to: [{ email: brokerage.email }],
                subject: `[Neurata] Payment failed for ${scPlan || 'your subscription'}`,
                html: `<p>A payment for your Neurata subscription${scPlan ? ' (' + scPlan + ')' : ''} failed to process. Please update your payment method at <a href="https://app.neurata.ai">app.neurata.ai</a> to avoid interruption of service.</p>`,
              })
            });
          }
        } catch(e) { console.error('Payment failed email error:', e); }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      // Subscription cancelled — deactivate SC in Supabase
      const sub = event.data.object;
      const scPlan = sub.metadata && sub.metadata.sc_plan;
      if (scPlan && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/strata_corps?plan_number=eq.${encodeURIComponent(scPlan)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            is_subscribed: false,
            ss_tier: null,
            stripe_subscription_id: null,
            mm_pending_cancel: false
          })
        });
      }
    }

    if (event.type === 'customer.subscription.updated') {
      // Subscription changed — sync ss_tier if it changed
      const sub = event.data.object;
      const scPlan = sub.metadata && sub.metadata.sc_plan;
      const ssTier = sub.metadata && sub.metadata.ss_tier;
      if (scPlan && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        const updates = { is_subscribed: sub.status === 'active' };
        if (ssTier) updates.ss_tier = ssTier;
        await fetch(`${SUPABASE_URL}/rest/v1/strata_corps?plan_number=eq.${encodeURIComponent(scPlan)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updates)
        });
      }
    }

    if (event.type === 'setup_intent.succeeded') {
      // Payment method confirmed — mark billing_setup true in Supabase
      const si = event.data.object;
      const customerId = si.customer;
      if (customerId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
        await fetch(`${SUPABASE_URL}/rest/v1/brokerages?stripe_customer_id=eq.${encodeURIComponent(customerId)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ billing_setup: true })
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), { headers: CORS });
  }

  // ── GET /brokerage-reps?lic=... → scrape BCFSA brokerage for rep list ──

  if (url.pathname === '/brokerage-reps') {
    const brkLic = url.searchParams.get('lic');
    if (!brkLic) return new Response(JSON.stringify({ error: 'missing lic' }), { status: 400, headers: CORS });
    try {
      const r = await fetch('https://www.bcfsa.ca/re-brokerage/' + brkLic, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (!r.ok) return new Response(JSON.stringify({ error: 'BCFSA returned ' + r.status, html_preview: '' }), { status: 502, headers: CORS });
      const html = await r.text();
      const reps = [];
      const seen = new Set();

      // BCFSA brokerage page structure (confirmed from DOM):
      // <dl class="g-definition-list">
      //   <div flex>
      //     <dt>Managing Brokers:</dt>
      //     <dd><ul><li><a href="/re-licencee/183255">Name</a></li></ul></dd>
      //   </div>
      //   ...more divs for each role group...
      // </dl>
      //
      // Strategy: extract the <dl class="g-definition-list"> block first,
      // then split it on <dt> tags to get each role section with its links.

      const titleMap = {
        'managing brokers':  'Managing Broker',
        'managing broker':   'Managing Broker',
        'associate brokers': 'Associate Broker',
        'associate broker':  'Associate Broker',
        'representatives':   'Representative',
        'representative':    'Representative',
        'strata managers':   'Strata Manager',
        'strata manager':    'Strata Manager',
        'property managers': 'Property Manager',
        'property manager':  'Property Manager',
        'rental managers':   'Rental Manager',
        'rental manager':    'Rental Manager',
        'assistants':        'Assistant',
        'assistant':         'Assistant',
      };

      // Extract the g-definition-list block — this is where all role groups live
      const dlMatch = html.match(/<dl[^>]*class="[^"]*g-definition-list[^"]*"[^>]*>([\s\S]*?)<\/dl>/i);
      const dlHtml  = dlMatch ? dlMatch[1] : html; // fall back to full page if not found

      // Split on each <dt> — everything between a <dt> and the next <dt> belongs to that role
      // Pattern: find each <dt>LABEL</dt> then grab all licencee hrefs until the next <dt>
      const dtSplitRe = /<dt[^>]*>\s*([^<]+?)\s*<\/dt>([\s\S]*?)(?=<dt[^>]*>|$)/gi;
      let sec;
      while ((sec = dtSplitRe.exec(dlHtml)) !== null) {
        const rawLabel = sec[1].replace(/:$/,'').trim();
        const title    = titleMap[rawLabel.toLowerCase()];
        if (!title) continue; // skip non-role labels
        const sectionHtml = sec[2];
        // Extract all licencee links in this section
        const linkRe = /\/re-licencee\/([A-Z0-9]+)[^>]*>([^<]+)</gi;
        let lm;
        while ((lm = linkRe.exec(sectionHtml)) !== null) {
          const lic  = lm[1].trim();
          const name = lm[2].replace(/&amp;/g,'&').replace(/&#\d+;/g,'').trim();
          if (!seen.has(lic) && name && name.length > 2) {
            seen.add(lic);
            reps.push({ name, lic, title, status: 'Active' });
          }
        }
      }
      // Extract brokerage name and address from the page
      // BCFSA page structure: brokerage name is in <h2> inside the licence info section
      // NOT in <h1> which says "Real Estate Professional Information"
      let brkName = '', brkAddress = '', brkPhone = '';

      // Name: <h2> immediately after the squircle icon section (contains the brokerage name)
      // Pattern: look for h2 that is NOT a nav/footer heading and comes after the licence section
      const h2Matches = [...html.matchAll(/<h2[^>]*>\s*([^<]{3,80}?)\s*<\/h2>/gi)];
      for (const m of h2Matches) {
        const candidate = m[1].replace(/&amp;/g,'&').trim();
        // Skip known non-name headings
        if (/breadcrumb|professional information|security notice|professionals|skip|menu/i.test(candidate)) continue;
        if (candidate.length > 3 && candidate.length < 100) { brkName = candidate; break; }
      }
      // Fallback: og:title meta tag which BCFSA always sets to the brokerage name
      if (!brkName) {
        const ogTitle = html.match(/property="og:title"[^>]*content="([^"]+)"/i)
          || html.match(/content="([^"]+)"[^>]*property="og:title"/i);
        if (ogTitle) brkName = ogTitle[1].replace(/&amp;/g,'&').trim();
      }
      // Fallback: <title> before the pipe
      if (!brkName) {
        const titleMatch = html.match(/<title[^>]*>([^|<]+)/i);
        if (titleMatch) brkName = titleMatch[1].replace(/&amp;/g,'&').trim();
      }

      // Address: "Business Address:" label followed by value
      const addrLabelMatch = html.match(/Business Address:\s*<\/dt>\s*<dd[^>]*>\s*([^<]+)/i)
        || html.match(/Business Address[^<]*<\/[^>]+>\s*([^\n<]{5,})/i)
        || html.match(/Business Address:\s*\n\s*([^\n<]{5,})/i);
      if (addrLabelMatch) brkAddress = addrLabelMatch[1].replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();

      // Phone: "Business Phone:" label
      const phoneLabelMatch = html.match(/Business Phone:\s*<\/dt>\s*<dd[^>]*>\s*([^<]+)/i)
        || html.match(/Business Phone[^<]*<\/[^>]+>\s*([^\n<]{5,})/i)
        || html.match(/Business Phone:\s*\n\s*([^\n<]{5,})/i);
      if (phoneLabelMatch) brkPhone = phoneLabelMatch[1].replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();

      // Fallback phone: any phone number pattern
      if (!brkPhone) {
        const phoneMatch = html.match(/(\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4})/);
        if (phoneMatch) brkPhone = phoneMatch[1].trim();
      }

      // Return raw html snippet for debugging if no reps found
      if (!reps.length) {
        return new Response(JSON.stringify({
          reps: [], name: brkName, address: brkAddress, phone: brkPhone,
          debug: html.slice(0, 800)
        }), { headers: CORS });
      }
      // Sort by title order: MB first, then AB, then others
      const titleOrder = {
        'Managing Broker': 0,
        'Associate Broker': 1,
        'Representative': 2,
        'Strata Manager': 2,
        'Property Manager': 2,
        'Rental Manager': 2,
        'Assistant': 3,
      };
      reps.sort((a, b) => {
        const ta = titleOrder[a.title] !== undefined ? titleOrder[a.title] : 5;
        const tb = titleOrder[b.title] !== undefined ? titleOrder[b.title] : 5;
        if (ta !== tb) return ta - tb;
        return a.name.localeCompare(b.name);
      });
      return new Response(JSON.stringify({ reps, name: brkName, address: brkAddress, phone: brkPhone }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /contact → demo request from marketing site ────────────────
  if (request.method === 'POST' && url.pathname === '/contact') {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim();
    const message = (body.message || '').trim();
    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers: CORS });
    }
    const sendKey = (typeof MAILTRAP_SEND_KEY !== 'undefined' && MAILTRAP_SEND_KEY)
      ? MAILTRAP_SEND_KEY
      : (typeof MAILTRAP_API_KEY !== 'undefined' && MAILTRAP_API_KEY)
      ? MAILTRAP_API_KEY : null;
    if (!sendKey) {
      return new Response(JSON.stringify({ error: 'No email key configured' }), { status: 500, headers: CORS });
    }
    const mtBody = {
      from: { email: 'info@neurata.ai', name: 'Neurata Website' },
      to: [{ email: 'info@neurata.ai' }],
      reply_to: { email: email },
      subject: `Demo Request — ${email}`,
      text: `New demo request from neurata.ai\n\nEmail: ${email}${message ? '\nMessage: ' + message : ''}`,
      html: `<p><strong>New demo request</strong></p><p><strong>From:</strong> ${email}</p>${message ? `<p><strong>Message:</strong> ${message}</p>` : ''}`
    };
    const mtResp = await fetch('https://send.api.mailtrap.io/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sendKey}` },
      body: JSON.stringify(mtBody)
    });
    const mtText = await mtResp.text();
    if (!mtResp.ok) {
      console.error('[contact] Mailtrap error:', mtResp.status, mtText);
      return new Response(JSON.stringify({ error: 'Mailtrap error', status: mtResp.status, detail: mtText }), { status: 500, headers: CORS });
    }
    // Send confirmation email to the submitter
    const confirmBody = {
      from: { email: 'info@neurata.ai', name: 'Jeremy at Neurata' },
      to: [{ email: email }],
      subject: 'Your Neurata demo request',
      headers: { 'X-Priority': '1', 'Importance': 'high' },
      category: 'transactional',
      html: `<div style='font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;max-width:520px;margin:0 auto;padding:24px'>`
        + `<img src='https://sozghbobflcjrfsmewxv.supabase.co/storage/v1/object/public/public-assets/neurata-logos/NeurataLogoOrangeWhite.png' height='32' alt='Neurata' style='margin-bottom:24px;display:block'/>`
        + `<p style='margin:0 0 16px'>Hi,</p>`
        + `<p style='margin:0 0 16px'>Thanks for reaching out — I'd love to show you what Neurata can do for your strata management practice.</p>`
        + `<p style='margin:0 0 16px'>You can book a 30-minute demo at a time that works for you:</p>`
        + `<p style='margin:0 0 24px'><a href='https://calendly.com/neurata/demo' style='color:#F97316;font-weight:600'>https://calendly.com/neurata/demo</a></p>`
        + `<p style='margin:0 0 16px'>The demo covers Meeting Mode, StrataSphere AI, and how Neurata fits into your existing workflow.</p>`
        + `<p style='margin:0'>Jeremy McCarron<br>Neurata<br><a href='mailto:info@neurata.ai' style='color:#F97316'>info@neurata.ai</a></p>`
        + `</div>`,
      text: `Hi,\n\nThanks for reaching out. Book your 30-minute Neurata demo here:\n\nhttps://calendly.com/neurata/demo\n\nThe demo covers Meeting Mode, StrataSphere AI, and how Neurata fits into your workflow.\n\nJeremy McCarron\nNeurata\ninfo@neurata.ai`
    };
    await fetch('https://send.api.mailtrap.io/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sendKey}` },
      body: JSON.stringify(confirmBody)
    }).catch(e => console.error('[contact] confirm email error:', e));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }

  // ── POST /contact-tribe → Tribe pitch page inquiry → jeremy@neurata.ai ──
  if (request.method === 'POST' && url.pathname === '/contact-tribe') {
    const body = await request.json().catch(() => ({}));
    const email = (body.email || '').trim();
    const name  = (body.name  || '').trim();
    const note  = (body.note  || '').trim();
    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers: CORS });
    }
    const sendKey = (typeof MAILTRAP_SEND_KEY !== 'undefined' && MAILTRAP_SEND_KEY)
      ? MAILTRAP_SEND_KEY
      : (typeof MAILTRAP_API_KEY !== 'undefined' && MAILTRAP_API_KEY)
      ? MAILTRAP_API_KEY : null;
    if (!sendKey) {
      return new Response(JSON.stringify({ error: 'No email key configured' }), { status: 500, headers: CORS });
    }
    const mtBody = {
      from: { email: 'info@neurata.ai', name: 'Neurata — Tribe Page' },
      to: [{ email: 'jeremy@neurata.ai' }],
      reply_to: { email: email },
      subject: `Tribe Pilot Inquiry — ${name || email}`,
      text: `New inquiry from the Tribe pitch page\n\nName: ${name || '(not provided)'}\nEmail: ${email}${note ? '\nNote: ' + note : ''}`,
      html: `<p><strong>New Tribe pitch page inquiry</strong></p><p><strong>Name:</strong> ${name || '(not provided)'}</p><p><strong>Email:</strong> ${email}</p>${note ? `<p><strong>Note:</strong> ${note}</p>` : ''}`
    };
    const mtResp = await fetch('https://send.api.mailtrap.io/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sendKey}` },
      body: JSON.stringify(mtBody)
    });
    if (!mtResp.ok) {
      const mtText = await mtResp.text();
      console.error('[contact-tribe] Mailtrap error:', mtResp.status, mtText);
      return new Response(JSON.stringify({ error: 'Mailtrap error' }), { status: 500, headers: CORS });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }

  // ── POST /send-invite → send invitation email via Postmark ──────────
  if (request.method === 'POST' && url.pathname === '/send-invite') {
    if (typeof MAILTRAP_API_KEY === 'undefined' || !MAILTRAP_API_KEY) {
      return new Response(JSON.stringify({ error: 'MAILTRAP_API_KEY not configured' }), { status: 500, headers: CORS });
    }
    let body;
    try { body = await request.json(); } catch(e) { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: CORS }); }

    const { to, toName, fromName, brokerage, scPlan, scName, inviteUrl, type } = body;
    if (!to || (!inviteUrl && type !== 'activation_request' && type !== 'asst_invite' && type !== 'rep_assigned')) return new Response(JSON.stringify({ error: 'missing to or inviteUrl' }), { status: 400, headers: CORS });

    // Build email content based on type
    const isDelegate = type === 'delegate';
    const isActivationRequest = type === 'activation_request';
    const isAsstInvite = type === 'asst_invite';
    const isRepAssigned = type === 'rep_assigned';
    const subject = isRepAssigned
      ? `You've been connected to ${scPlan} on Neurata`
      : isActivationRequest
      ? `[Neurata] Activation Request: ${body.requestType} for ${scPlan}`
      : isAsstInvite
      ? `You've been invited to join ${scPlan} on Neurata as an Assistant`
      : isDelegate
      ? `You've been invited to the ${scPlan} strata portal`
      : `You've been invited to join ${brokerage} on Neurata`;

    // Shared email shell
    const emailShell = (content) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Neurata</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
<tr><td align="center">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <!-- Header -->
  <tr><td style="background:#231f20;padding:24px 32px;text-align:center">
    <img src="https://sozghbobflcjrfsmewxv.supabase.co/storage/v1/object/public/public-assets/neurata-logos/NeurataLogoOrangeWhite.png" height="36" alt="Neurata" style="display:inline-block;max-width:180px"/>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:32px">${content}</td></tr>
  <!-- Footer -->
  <tr><td style="background:#f4f4f5;padding:20px 32px;text-align:center;border-top:1px solid #e5e5e5">
    <p style="margin:0;font-size:11px;color:#999;line-height:1.6">
      Neurata.ai &nbsp;·&nbsp; BC Strata Intelligence Platform<br>
      <a href="https://neurata.ai" style="color:#999;text-decoration:none">neurata.ai</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

    const btnStyle = 'display:inline-block;background:#F6921E;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.01em';
    const h1Style = 'margin:0 0 16px;font-size:22px;font-weight:700;color:#231f20;line-height:1.3';
    const pStyle  = 'margin:0 0 14px;font-size:14px;color:#444444;line-height:1.7';
    const metaStyle = 'margin:0 0 14px;font-size:13px;color:#666;line-height:1.6;background:#f9f9f9;border-left:3px solid #E8212A;padding:10px 14px;border-radius:0 4px 4px 0';

    const htmlBody = isRepAssigned
      ? emailShell(`
        <h1 style="${h1Style}">You've been connected to ${scPlan}${scName ? ' — ' + scName : ''}</h1>
        <p style="${pStyle}"><strong>${fromName || 'Your Managing Broker'}</strong> at <strong>${brokerage}</strong> has added you as a Representative for <strong>${scPlan}${scName ? ' — ' + scName : ''}</strong> on Neurata.</p>
        <p style="${pStyle}">You can access this strata corporation's meetings, minutes, and documents right from your dashboard.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${body.appUrl || 'https://app.neurata.ai'}" style="${btnStyle}">Log In to Neurata →</a>
        </div>
        <p style="margin:0;font-size:12px;color:#999;line-height:1.6">If you have questions, contact ${fromName || 'your Managing Broker'} at ${brokerage}.</p>`)
      : isActivationRequest
      ? emailShell(`
        <h1 style="${h1Style}">Your team needs you.</h1>
        <p style="${pStyle}"><strong>${fromName || 'A team member'}</strong> is requesting <strong>${body.requestType}</strong> for <strong>${scPlan}${scName ? ' — ' + scName : ''}</strong> and needs a Managing Broker to activate the subscription.</p>
        <div style="${metaStyle}">
          <strong>Strata Corporation:</strong> ${scPlan}${scName ? ' — ' + scName : ''}<br>
          <strong>Product:</strong> ${body.requestType}<br>
          <strong>Requested by:</strong> ${fromName || 'Team member'}<br>
          <strong>Brokerage:</strong> ${brokerage}
        </div>
        <p style="${pStyle}">Log in with your BCFSA licence number to review and approve — or create your account if you haven't already.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${body.appUrl || 'https://app.neurata.ai'}" style="${btnStyle}">Log In or Sign Up →</a>
        </div>
        <p style="margin:0;font-size:12px;color:#999;line-height:1.6">Once logged in, go to the <strong>Billing</strong> page to review and approve this request. Don't have an account? Create one using your BCFSA licence number. Questions? Reply to this email.</p>`)
      : isDelegate
      ? emailShell(`
        <h1 style="${h1Style}">You've been invited to your strata portal</h1>
        <p style="${pStyle}">${fromName || 'Your strata manager'} has invited you to access the strata council portal for <strong>${scPlan}${scName ? ' — ' + scName : ''}</strong> on Neurata.</p>
        <div style="${metaStyle}">
          <strong>Strata Corporation:</strong> ${scPlan}${scName ? ' — ' + scName : ''}<br>
          <strong>Managed by:</strong> ${brokerage || 'your strata management company'}
        </div>
        <p style="${pStyle}">As a council delegate, you’ll be able to view meeting agendas, minutes, and important strata documents for your building.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${inviteUrl}" style="${btnStyle}">Accept Invitation →</a>
        </div>
        <p style="margin:0;font-size:12px;color:#999;line-height:1.6">If you weren’t expecting this invitation, you can ignore this email.</p>`)
      : emailShell(`
        <h1 style="${h1Style}">You've been invited to join Neurata</h1>
        <p style="${pStyle}"><strong>${fromName || 'Your Managing Broker'}</strong> has invited you to join <strong>${brokerage}</strong>${scPlan ? ' to help manage <strong>' + scPlan + (scName ? ' — ' + scName : '') + '</strong>' : ''} on Neurata.</p>
        <p style="${pStyle}">Better agendas. Faster meetings. Instant minutes.</p>
        <div style="text-align:center;margin:32px 0">
          <a href="${inviteUrl}" style="${btnStyle}">Get Started →</a>
        </div>
        <p style="margin:0;font-size:12px;color:#999;line-height:1.6">Didn’t expect this? Safely ignore it. Sent on behalf of ${fromName || 'a licensed BCFSA representative'} at ${brokerage}.</p>`);

    try {
      const mtResp = await fetch('https://send.api.mailtrap.io/api/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (MAILTRAP_SEND_KEY || MAILTRAP_API_KEY),
        },
        body: JSON.stringify({
          from: { email: 'info@neurata.ai', name: 'Neurata' },
          to: [{ email: to, name: toName || to }],
          subject: subject,
          html: htmlBody,
        })
      });
      const mtData = await mtResp.json();
      if (!mtResp.ok) {
        return new Response(JSON.stringify({ error: 'MailTrap error: ' + JSON.stringify(mtData) }), { status: 502, headers: CORS });
      }
      return new Response(JSON.stringify({ ok: true, messageId: mtData.message_ids && mtData.message_ids[0] }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Email send failed: ' + e.message }), { status: 500, headers: CORS });
    }
  }

  // ── Shared email helper ───────────────────────────────────────────────────
  async function sendEmail(to, toName, subject, html) {
    const resp = await fetch('https://send.api.mailtrap.io/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MAILTRAP_SEND_KEY || MAILTRAP_API_KEY}` },
      body: JSON.stringify({
        from: { email: 'info@neurata.ai', name: 'Neurata' },
        to: [{ email: to, name: toName || to }],
        subject, html
      })
    });
    return resp.ok;
  }

  function emailShell(content) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px"><tr><td align="center">
<table width="100%" style="max-width:520px;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <tr><td style="background:#231f20;padding:24px 32px;text-align:center">
    <img src="https://sozghbobflcjrfsmewxv.supabase.co/storage/v1/object/public/public-assets/neurata-logos/NeurataLogoOrangeWhite.png" height="36" alt="Neurata" style="display:inline-block;max-width:180px"/>
  </td></tr>
  <tr><td style="padding:32px">${content}</td></tr>
  <tr><td style="background:#f4f4f5;padding:20px 32px;text-align:center;border-top:1px solid #e5e5e5">
    <p style="margin:0;font-size:11px;color:#999;line-height:1.6">Neurata.ai · BC Strata Intelligence Platform<br>
    Questions? <a href="mailto:info@neurata.ai" style="color:#999;text-decoration:none">info@neurata.ai</a></p>
  </td></tr>
</table></td></tr></table></body></html>`;
  }

  const btnStyle = 'display:inline-block;background:#F6921E;color:#ffffff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px';
  const h1Style = 'margin:0 0 16px;font-size:22px;font-weight:700;color:#231f20;line-height:1.3';
  const pStyle  = 'margin:0 0 14px;font-size:14px;color:#444444;line-height:1.7';
  const metaStyle = 'margin:0 0 20px;font-size:13px;color:#666;line-height:1.8;background:#f9f9f9;border-left:3px solid #F6921E;padding:12px 16px;border-radius:0 4px 4px 0';

  // ── GET /brokerage-exists → check if brokerage exists (no auth needed) ──────
  if (request.method === 'GET' && url.pathname === '/brokerage-exists') {
    const lic = url.searchParams.get('lic');
    if (!lic) return new Response(JSON.stringify({ exists: false }), { status: 200, headers: CORS });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brokerages?select=bcfsa_lic&bcfsa_lic=eq.${encodeURIComponent(lic)}&limit=1`, {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      }
    });
    const data = await res.json();
    return new Response(JSON.stringify({ exists: Array.isArray(data) && data.length > 0 }), { status: 200, headers: CORS });
  }

  // ── POST /register → upserts brokerage + user rows using service key ────────
  // Called from obComplete after signUp — new user JWT may not be fully provisioned
  if (request.method === 'POST' && url.pathname === '/register') {
    let body;
    try { body = await request.json(); } catch(e) {
      return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: CORS });
    }
    const { userId, email, fullName, bcfsaLic, role, brkLic, brkName, brkAddr, brkPhone, brkExists } = body;

    if (!userId || !brkLic || !bcfsaLic) {
      return new Response(JSON.stringify({ error: 'missing required fields', got: {userId,brkLic,bcfsaLic} }), { status: 400, headers: CORS });
    }

    const svcHeaders = {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    };

    // Upsert brokerage
    const brkData = { bcfsa_lic: brkLic, name: brkName || brkLic, address: brkAddr || null, phone: brkPhone || null };
    if (!brkExists) { brkData.subscription_status = 'trial'; brkData.trial_meetings_used = 0; }

    const brkRes = await fetch(`${SUPABASE_URL}/rest/v1/brokerages`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(brkData)
    });

    if (!brkRes.ok) {
      const err = await brkRes.text();
      console.error('[register] brokerage upsert failed:', brkRes.status, err);
      return new Response(JSON.stringify({ error: 'brokerage upsert failed', status: brkRes.status, detail: err }), { status: 500, headers: CORS });
    }

    // Upsert user row
    const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: userId,
        brokerage_id: brkLic,
        full_name: fullName,
        email: email,
        bcfsa_lic: bcfsaLic,
        role: role || 'Managing Broker'
      })
    });

    if (!userRes.ok) {
      const err = await userRes.text();
      console.error('[register] user upsert failed:', userRes.status, err);
      return new Response(JSON.stringify({ error: 'user upsert failed', status: userRes.status, detail: err }), { status: 500, headers: CORS });
    }

    // Update auth.users app_metadata with brokerage_id and role
    const metaRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: svcHeaders,
      body: JSON.stringify({ app_metadata: { brokerage_id: brkLic, role: role || 'Managing Broker' } })
    });

    if (!metaRes.ok) {
      const err = await metaRes.text();
      console.error('[register] metadata update failed:', metaRes.status, err);
      // Non-fatal — refreshSession will retry
    }

    // Write sc_users rows for invited SCs (reps only)
    const scPlans = body.scPlans || [];
    for (const plan of scPlans) {
      const scUserRes = await fetch(`${SUPABASE_URL}/rest/v1/sc_users`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ sc_id: plan, user_id: userId, access_type: 'rep' })
      });
      if (!scUserRes.ok) {
        const err = await scUserRes.text();
        console.error('[register] sc_users upsert failed for', plan, scUserRes.status, err);
      }
    }

    // Update reps table with sc_ids for invited SCs
    if (scPlans.length && brkLic) {
      // Get existing sc_ids
      const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/reps?brokerage_id=eq.${encodeURIComponent(brkLic)}&bcfsa_lic=eq.${encodeURIComponent(bcfsaLic)}&select=sc_ids&limit=1`, {
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
      });
      let existingScIds = [];
      if (existingRes.ok) {
        const existing = await existingRes.json();
        if (existing && existing[0] && existing[0].sc_ids) {
          try { existingScIds = JSON.parse(existing[0].sc_ids); } catch(e) {}
        }
      }
      scPlans.forEach(p => { if (!existingScIds.includes(p)) existingScIds.push(p); });
      await fetch(`${SUPABASE_URL}/rest/v1/reps`, {
        method: 'POST',
        headers: { ...svcHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ brokerage_id: brkLic, bcfsa_lic: bcfsaLic, name: fullName || '', sc_ids: JSON.stringify(existingScIds) })
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }

  // ── POST /admin/create-user → SA only, creates auth user via service key ──
  if (request.method === 'POST' && url.pathname === '/admin/create-user') {
    let body;
    try { body = await request.json(); } catch(e) { return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:CORS}); }
    const { email, password, brokerage_id, role } = body;
    if (!email || !password || !brokerage_id || !role) {
      return new Response(JSON.stringify({error:'Missing fields'}),{status:400,headers:CORS});
    }
    try {
      const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          email, password,
          email_confirm: true,
          app_metadata: { brokerage_id, role }
        })
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        return new Response(JSON.stringify({error: data.error || data.msg || 'Failed to create user'}),{status:400,headers:CORS});
      }
      return new Response(JSON.stringify({ok:true, userId: data.id}),{headers:CORS});
    } catch(e) {
      return new Response(JSON.stringify({error:e.message}),{status:500,headers:CORS});
    }
  }

  // ── POST /send-welcome ────────────────────────────────────────────────────
  if (request.method === 'POST' && url.pathname === '/send-welcome') {
    let body;
    try { body = await request.json(); } catch(e) { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: CORS }); }
    const { to, name, role, brokerage } = body;
    if (!to) return new Response(JSON.stringify({ error: 'missing to' }), { status: 400, headers: CORS });

    const isMB = role === 'Managing Broker';
    const isAB = role === 'Associate Broker';
    const isRep = role === 'Representative';

    const html = emailShell(`
      <h1 style="${h1Style}">Welcome to Neurata${name ? ', ' + name.split(' ')[0] : ''}.</h1>
      <p style="${pStyle}">Your account for <strong>${brokerage || 'your brokerage'}</strong> is ready. Here's what you can do right now:</p>
      <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;color:#444;line-height:2">
        <li>Upload a Strata Plan to add a strata corporation</li>
        <li>Build a meeting agenda and launch Meeting Mode</li>
        <li>Index your bylaws and documents for StrataSphere AI</li>
        ${isMB ? '<li>Set up billing to activate full Meeting Mode and StrataSphere</li>' : ''}
        ${(isRep || isAB) ? '<li>Invite your Managing Broker to set up billing and unlock full access</li>' : ''}
      </ul>
      ${(isRep || isAB) ? `<p style="${pStyle}">You have <strong>2 free trial meetings</strong> to explore the platform. Invite your Managing Broker when you're ready to activate a subscription.</p>` : ''}
      <div style="text-align:center;margin:28px 0">
        <a href="https://app.neurata.ai" style="${btnStyle}">Get Started →</a>
      </div>
      <p style="margin:0;font-size:12px;color:#999;line-height:1.6">Need help? Reply to this email — we're here.</p>
    `);

    try {
      await sendEmail(to, name, `Welcome to Neurata${brokerage ? ', ' + brokerage : ''}`, html);
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /send-activation-confirmed ──────────────────────────────────────
  if (request.method === 'POST' && url.pathname === '/send-activation-confirmed') {
    let body;
    try { body = await request.json(); } catch(e) { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: CORS }); }
    const { to, name, scPlan, scName, ssTier, lots, proratedAmount, monthlyAmount, nextChargeDate } = body;
    if (!to || !scPlan) return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers: CORS });

    const tierLabel = ssTier === 'global' ? 'Global StrataSphere' : 'Local StrataSphere';
    const ssRate    = ssTier === 'global' ? 2.49 : 1.49;
    const mmAmt     = (39.00).toFixed(2);
    const ssAmt     = (ssRate * (lots || 1)).toFixed(2);
    const totalAmt  = ((monthlyAmount || 0) / 100).toFixed(2);
    const proratedFmt = ((proratedAmount || 0) / 100).toFixed(2);

    const html = emailShell(`
      <h1 style="${h1Style}">You're live on Meeting Mode.</h1>
      <p style="${pStyle}"><strong>${scPlan}${scName ? ' — ' + scName : ''}</strong> is now active on Meeting Mode + ${tierLabel}.</p>
      <div style="${metaStyle}">
        <strong>Plan:</strong> Meeting Mode + ${tierLabel}<br>
        <strong>Monthly:</strong> CA$${totalAmt}/month + GST<br>
        &nbsp;&nbsp;· Meeting Mode: CA$${mmAmt}/month<br>
        &nbsp;&nbsp;· ${tierLabel}: CA$${ssRate}/lot × ${lots} lots = CA$${ssAmt}/month<br>
        <strong>Charged today:</strong> CA$${proratedFmt} (prorated) + GST<br>
        <strong>Next charge:</strong> ${nextChargeDate || 'the 1st of next month'}
      </div>
      <p style="${pStyle}">Recurring billing begins on the 1st of each month. You can manage your subscription any time from the Billing page.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="https://app.neurata.ai" style="${btnStyle}">Go to Neurata →</a>
      </div>
      <p style="margin:0;font-size:12px;color:#999;line-height:1.6">Questions about your bill? Reply to this email.</p>
    `);

    try {
      await sendEmail(to, name, `Meeting Mode activated — ${scPlan}`, html);
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /send-trial-exhausted ────────────────────────────────────────────
  if (request.method === 'POST' && url.pathname === '/send-trial-exhausted') {
    let body;
    try { body = await request.json(); } catch(e) { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: CORS }); }
    const { to, name, scPlan, scName } = body;
    if (!to) return new Response(JSON.stringify({ error: 'missing to' }), { status: 400, headers: CORS });

    const html = emailShell(`
      <h1 style="${h1Style}">Your free trial is complete.</h1>
      <p style="${pStyle}">You've used both of your free trial meetings${scPlan ? ' on <strong>' + scPlan + (scName ? ' — ' + scName : '') + '</strong>' : ''}. We hope it was worth it.</p>
      <p style="${pStyle}">To keep running meetings, generating minutes, and using StrataSphere AI, activate a Meeting Mode subscription.</p>
      <div style="${metaStyle}">
        <strong>Meeting Mode + Local StrataSphere</strong> from CA$39/month<br>
        <strong>Meeting Mode + Global StrataSphere</strong> from CA$39/month + CA$2.49/lot
      </div>
      <p style="${pStyle}">No contracts. Cancel any time.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="https://app.neurata.ai" style="${btnStyle}">Activate Now →</a>
      </div>
      <p style="margin:0;font-size:12px;color:#999;line-height:1.6">Not ready? Your data is safe — you can activate any time. Questions? Reply to this email.</p>
    `);

    try {
      await sendEmail(to, name, 'Your Neurata free trial is complete', html);
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }
  const lic = url.searchParams.get('lic');
  if (!lic) return new Response(JSON.stringify({ error: 'missing lic' }), { status: 400, headers: CORS });

  let licHtml;
  try {
    const r = await fetch('https://www.bcfsa.ca/re-licencee/' + lic, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    licHtml = r.ok ? await r.text() : null;
  } catch (e) {
    return new Response(JSON.stringify({ error: 'bcfsa_unreachable' }), { status: 502, headers: CORS });
  }

  // Check dummy licences first
  if (DUMMY_LICENCES[lic.toUpperCase()]) {
    return new Response(JSON.stringify(DUMMY_LICENCES[lic.toUpperCase()]), { headers: CORS });
  }

  if (!licHtml || !licHtml.includes('Licence Number')) {
    return new Response(JSON.stringify({ notFound: true }), { headers: CORS });
  }

  const rep = {
    name:            dt(licHtml, 'Legal Name'),
    knownAs:         dt(licHtml, 'Known As'),
    licensedAs:      dt(licHtml, 'Licensed As'),
    licensedFor:     dt(licHtml, 'Licensed For'),
    licenceStatus:   dt(licHtml, 'Licence Status'),
    licenceExpiry:   dt(licHtml, 'Licence Expiry'),
    businessName:    dt(licHtml, 'Business Name'),
    businessAddress: dt(licHtml, 'Business Address'),
    businessPhone:   dt(licHtml, 'Business Number'),
    discipline:      dt(licHtml, 'Discipline'),
  };

  const brkMatch = licHtml.match(/re-brokerage\/([A-Z0-9]+)/);
  rep.businessLicence = brkMatch ? brkMatch[1] : '';

  if (rep.businessLicence) {
    try {
      const r = await fetch('https://www.bcfsa.ca/re-brokerage/' + rep.businessLicence, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (r.ok) {
        const brkHtml = await r.text();
        rep.brkName        = dt(brkHtml, 'Legal Name') || dt(brkHtml, 'Business Name') || rep.businessName || '';
        rep.brkAddress     = dt(brkHtml, 'Business Address');
        rep.brkPhone       = dt(brkHtml, 'Business Phone');
        rep.brkLicencedFor = dt(brkHtml, 'Licensed For');
        rep.brkStatus      = dt(brkHtml, 'Licence Status');
        rep.brkExpiry      = dt(brkHtml, 'Licence Expiry');
      }
    } catch (e) { /* proceed without brokerage data */ }
  }

  return new Response(JSON.stringify(rep), { headers: CORS });
}

function dt(html, label) {
  // Try classic <dt>/<dd> format first
  const re = new RegExp('<dt[^>]*>\\s*' + label + '\\s*:?\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>', 'i');
  const m = html.match(re);
  if (m) return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Try: label text followed by closing tag then opening tag then value
  // Handles: <p>Known As:</p><p>Abduol Said</p> or similar
  const re2 = new RegExp(label + '\\s*:?\\s*<\\/[^>]+>\\s*(?:<[^>]+>\\s*)*([^<]{1,120})', 'i');
  const m2 = html.match(re2);
  if (m2) return m2[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  // Try: label inside a tag, value in next sibling tag
  const re3 = new RegExp('<[^>]+>\\s*' + label + '\\s*:?\\s*<\\/[^>]+>\\s*<[^>]+>\\s*([^<]{1,120})\\s*<\\/[^>]+>', 'i');
  const m3 = html.match(re3);
  if (m3) return m3[1].replace(/\s+/g, ' ').trim();

  return '';
}