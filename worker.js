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

const CORS = {
  'Access-Control-Allow-Origin': '*',
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
  event.respondWith(handleRequest(event.request).catch(err => {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
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
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: anthropicHeaders,
        body: body,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Failed to reach Anthropic: ' + e.message }), { status: 502, headers: CORS });
    }

    const data = await resp.text();
    return new Response(data, { status: resp.status, headers: CORS });
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
      // Return raw html snippet for debugging if no reps found
      if (!reps.length) {
        return new Response(JSON.stringify({ reps: [], debug: html.slice(0, 500) }), { headers: CORS });
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
      return new Response(JSON.stringify({ reps }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
    }
  }

  // ── POST /send-invite → send invitation email via Postmark ──────────
  if (request.method === 'POST' && url.pathname === '/send-invite') {
    if (typeof POSTMARK_API_KEY === 'undefined' || !POSTMARK_API_KEY) {
      return new Response(JSON.stringify({ error: 'POSTMARK_API_KEY not configured' }), { status: 500, headers: CORS });
    }
    let body;
    try { body = await request.json(); } catch(e) { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: CORS }); }

    const { to, toName, fromName, brokerage, scPlan, scName, inviteUrl, type } = body;
    if (!to || (!inviteUrl && type !== 'activation_request')) return new Response(JSON.stringify({ error: 'missing to or inviteUrl' }), { status: 400, headers: CORS });

    // Build email content based on type
    const isDelegate = type === 'delegate';
    const isActivationRequest = type === 'activation_request';
    const subject = isActivationRequest
      ? `[Neurata] Activation Request: ${body.requestType} for ${scPlan}`
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
    <img src="https://sozghbobflcjrfsmewxv.supabase.co/storage/v1/object/public/public-assets/NeurataLogoOrangeWhite.svg" height="36" alt="Neurata" style="display:inline-block;max-width:180px"/>
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

    const htmlBody = isActivationRequest
      ? emailShell(`
        <h1 style="${h1Style}">Activation Request</h1>
        <p style="${pStyle}"><strong>${fromName || 'A team member'}</strong> has requested <strong>${body.requestType}</strong> activation for <strong>${scPlan}${scName ? ' — ' + scName : ''}</strong> on Neurata.</p>
        <div style="${metaStyle}">
          <strong>Strata Corporation:</strong> ${scPlan}${scName ? ' — ' + scName : ''}<br>
          <strong>Product:</strong> ${body.requestType}<br>
          <strong>Requested by:</strong> ${fromName || 'Team member'}<br>
          <strong>Brokerage:</strong> ${brokerage}
        </div>
        <p style="${pStyle}">Log in to your Billing page to review and activate this request.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="https://app.neurata.ai" style="${btnStyle}">Review on Billing Page →</a>
        </div>
        <p style="margin:0;font-size:12px;color:#999">This request was submitted by ${fromName || 'a team member'} on your Neurata platform.</p>`)
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
        <h1 style="${h1Style}">You’ve been invited to join Neurata</h1>
        <p style="${pStyle}">${fromName || 'Your Managing Broker'} has invited you to join <strong>${brokerage}</strong> on Neurata — BC’s strata intelligence platform.</p>
        ${scPlan ? `<div style="${metaStyle}"><strong>Assigned to:</strong> ${scPlan}${scName ? ' — ' + scName : ''}</div>` : ''}
        <p style="${pStyle}">Create your account using your BCFSA licence number. It only takes a minute.</p>
        <div style="text-align:center;margin:28px 0">
          <a href="${inviteUrl}" style="${btnStyle}">Create Your Account →</a>
        </div>
        <p style="margin:0;font-size:12px;color:#999;line-height:1.6">If you weren’t expecting this invitation, you can ignore this email. This invitation was sent by ${fromName || 'a licensed BCFSA representative'}.</p>`);

    try {
      const pmResp = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': POSTMARK_API_KEY,
        },
        body: JSON.stringify({
          From: 'Neurata <info@neurata.ai>',
          To: toName ? (toName + ' <' + to + '>') : to,
          Subject: subject,
          HtmlBody: htmlBody,
          MessageStream: 'outbound',
        })
      });
      const pmData = await pmResp.json();
      if (pmData.ErrorCode) {
        return new Response(JSON.stringify({ error: 'Postmark error: ' + pmData.Message }), { status: 502, headers: CORS });
      }
      return new Response(JSON.stringify({ ok: true, messageId: pmData.MessageID }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Email send failed: ' + e.message }), { status: 500, headers: CORS });
    }
  }

  // ── GET /?lic=... → scrape BCFSA ────────────────────────────────────
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
        rep.brkName        = dt(brkHtml, 'Legal Name');
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
  const re = new RegExp('<dt[^>]*>\\s*' + label + '\\s*:?\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>', 'i');
  const m = html.match(re);
  if (!m) return '';
  return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
