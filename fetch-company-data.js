// ════════════════════════════════════════════════════════════
//  SIA Company Dashboard — Airtable data fetcher
//  Runs daily via GitHub Actions after prices are updated.
//  Reads TOKEN and BASE from environment variables (GitHub Secrets).
//  Saves all company data to sia-company-data.json.
// ════════════════════════════════════════════════════════════

const https = require('https');
const fs    = require('fs');

const TOKEN = process.env.COMPANY_AIRTABLE_TOKEN;
const BASE  = process.env.COMPANY_AIRTABLE_BASE;

if (!TOKEN || !BASE) {
  console.error('ERROR: COMPANY_AIRTABLE_TOKEN or COMPANY_AIRTABLE_BASE environment variable is missing.');
  console.error('Make sure both are added as repository secrets in GitHub.');
  process.exit(1);
}

const T_CO  = 'Company Data';
const T_GR  = 'Graph Data';
const T_OWN = 'Owned by';

// Only keep the fields the dashboard actually uses — keeps the JSON file small
const COMPANY_FIELDS  = ['Logo SQ','NAME','TICKER','CURRENT PRICE','P/E Ratio','DIVIDEND YIELD','SECTOR','INDUSTRY','DESCRIPTION','5-YEAR RETURNS','10-YEAR RETURNS','PAST RESULTS SCORE','INDIVIDUAL INSIDERS','INVESTORS SCORE','ROIC','NET PROFIT MARGIN','SHARE BUYBACK','NET DEBT PAYBACK PERIOD','FINANCIAL HEALTH SCORE','REVENUE GROWTH','FCF GROWTH','EPS GROWTH','GROWTH SCORE','PAYOUT RATIO','DIVIDEND GROWTH','DIVDIENDS SCORE','Company Average Growth','DCF Company Average Growth','DCF Company Average Growth with 30%','Industry Average Growth','DCF Sector Average Growth','DCF Sector Average Growth with 30%','Analyst consensus growth','DCF Analyst consensus growth','DCF Analyst consensus growth with 30%','INTRINSIC VALUE','CURRENT UPSIDE','VALUATION SCORE','OVERALL SCORE'];
const GRAPH_FIELDS    = ['Date','TICKER','Stock Price','Shares Outstanding','Net Debt','Revenue','EPS','FCF','Dividends'];
const INVESTOR_FIELDS = ['Name','Portfolio Link','Photo SQ','Stocks'];

function slimRecord(r, keepFields) {
  var slim = { id: r.id, fields: {} };
  keepFields.forEach(function(f) {
    if (r.fields && r.fields[f] !== undefined) slim.fields[f] = r.fields[f];
  });
  return slim;
}

// ── HTTP helper ───────────────────────────────────────────────
function airtableGet(path) {
  return new Promise(function(resolve, reject) {
    const options = {
      hostname: 'api.airtable.com',
      path:     path,
      headers:  { Authorization: 'Bearer ' + TOKEN }
    };
    https.get(options, function(res) {
      let body = '';
      res.on('data',  function(chunk) { body += chunk; });
      res.on('end',   function() {
        try {
          const data = JSON.parse(body);
          if (res.statusCode !== 200) {
            const msg = (data.error && data.error.message) ? data.error.message : 'HTTP ' + res.statusCode;
            reject(new Error(msg));
          } else {
            resolve(data);
          }
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// ── Fetch all pages from a table (with optional filter) ───────
async function fetchAllPages(table, formula, acc, offset) {
  let path = '/v0/' + BASE + '/' + encodeURIComponent(table) + '?pageSize=100';
  if (formula) path += '&filterByFormula=' + encodeURIComponent(formula);
  if (offset)  path += '&offset=' + encodeURIComponent(offset);
  const data = await airtableGet(path);
  const all  = (acc || []).concat(data.records || []);
  if (data.offset) {
    await sleep(250);
    return fetchAllPages(table, formula, all, data.offset);
  }
  return all;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('Fetching Company Data...');
  const companies = await fetchAllPages(T_CO, null, [], null);
  console.log('  ' + companies.length + ' company records');

  await sleep(500);

  console.log('Fetching Graph Data...');
  const graphRows = await fetchAllPages(T_GR, null, [], null);
  console.log('  ' + graphRows.length + ' graph rows');

  await sleep(500);

  console.log('Fetching Owned by (investor links)...');
  const investors = await fetchAllPages(T_OWN, null, [], null);
  console.log('  ' + investors.length + ' investor records');

  // ── Build the same structure as saveGlobalCache in sia-dashboard.js ──────
  const companyByTicker = {};
  companies.forEach(function(r) {
    const t = r.fields && r.fields.TICKER;
    if (t) companyByTicker[t] = slimRecord(r, COMPANY_FIELDS);
  });

  const graphByTicker = {};
  graphRows.forEach(function(r) {
    const t = r.fields && r.fields.TICKER;
    if (!t) return;
    if (!graphByTicker[t]) graphByTicker[t] = [];
    graphByTicker[t].push(slimRecord(r, GRAPH_FIELDS));
  });
  // Sort each ticker's rows by Date ascending (same as loadGraphData)
  Object.keys(graphByTicker).forEach(function(t) {
    graphByTicker[t].sort(function(a, b) {
      return (a.fields.Date || '') > (b.fields.Date || '') ? 1 : -1;
    });
  });

  const output = {
    ts:        Date.now(),
    companies: companyByTicker,
    graph:     graphByTicker,
    investors: investors.map(function(r) { return slimRecord(r, INVESTOR_FIELDS); })
  };

  fs.writeFileSync('sia-company-data.json', JSON.stringify(output));
  console.log('\n✓ Saved sia-company-data.json (' + Object.keys(companyByTicker).length + ' companies)');
}

main().catch(function(err) {
  console.error('FATAL ERROR:', err.message);
  process.exit(1);
});
