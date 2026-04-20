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
      return new Response(JSON.stringify({ reps }), { headers: CORS });
    } catch(e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
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
