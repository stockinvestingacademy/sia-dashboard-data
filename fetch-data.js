// ════════════════════════════════════════════════════════════
//  SIA ELITE INVESTOR — Airtable data fetcher
//  Runs daily via GitHub Actions.
//  Reads TOKEN and BASE from environment variables (GitHub Secrets).
//  Saves all investor data to sia-data.json.
// ════════════════════════════════════════════════════════════

const https = require('https');
const fs    = require('fs');

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE  = process.env.AIRTABLE_BASE;

if (!TOKEN || !BASE) {
  console.error('ERROR: AIRTABLE_TOKEN or AIRTABLE_BASE environment variable is missing.');
  console.error('Make sure both are added as repository secrets in GitHub.');
  process.exit(1);
}

const ALL_INVESTORS = [
  'Guy Spier','Mohnish Pabrai','Bill Ackman','Warren Buffett',
  'Seth Klarman','Li Lu','Terry Smith','Howard Marks',
  'David Tepper','Chuck Akre','Bruce Berkowitz','Chris Hohn',
  'David Abrams','Dev Kantesaria','Nelson Peltz'
];

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

// ── Fetch all pages for one investor table ────────────────────
async function fetchAllPages(tableName, acc, offset) {
  let path = '/v0/' + BASE + '/' + encodeURIComponent(tableName) + '?pageSize=100';
  if (offset) path += '&offset=' + encodeURIComponent(offset);
  const data = await airtableGet(path);
  const all  = (acc || []).concat(data.records || []);
  if (data.offset) {
    await sleep(250); // small pause to respect Airtable rate limits
    return fetchAllPages(tableName, all, data.offset);
  }
  return all;
}

// ── Fetch all investor photos + fund names ────────────────────
async function fetchProfiles() {
  console.log('Fetching investor profiles...');
  const data     = await airtableGet('/v0/' + BASE + '/Investors?maxRecords=50');
  const profiles = {};
  for (const rec of (data.records || [])) {
    const name = rec.fields['Name'] || rec.fields['name'] || '';
    if (!name) continue;
    let photoUrl = rec.fields['Photo SQ'] || '';
    if (!photoUrl) {
      const arr = rec.fields['Photo'] || rec.fields['photo'] || rec.fields['Image'] || rec.fields['image'] || [];
      if (arr.length > 0) {
        const att = arr[0];
        photoUrl  = (att.thumbnails && att.thumbnails.large && att.thumbnails.large.url)
                  ? att.thumbnails.large.url : att.url || '';
      }
    }
    const fund = rec.fields['Fund'] || rec.fields['fund'] || rec.fields['Fund Name'] || '';
    profiles[name] = { photoUrl, fund };
  }
  console.log('  Found profiles for: ' + Object.keys(profiles).join(', '));
  return profiles;
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const profiles   = await fetchProfiles();
  const byInvestor = {};

  // Fetch 3 investors at a time to stay within Airtable rate limits
  for (let i = 0; i < ALL_INVESTORS.length; i += 3) {
    const batch = ALL_INVESTORS.slice(i, i + 3);
    console.log('\nFetching: ' + batch.join(', '));

    const results = await Promise.all(batch.map(function(name) {
      return fetchAllPages(name, [], null).catch(function(e) {
        console.warn('  WARNING: failed to fetch "' + name + '": ' + e.message);
        return [];
      });
    }));

    batch.forEach(function(name, j) {
      const profile    = profiles[name] || {};
      byInvestor[name] = {
        records:  results[j] || [],
        photoUrl: profile.photoUrl || '',
        fund:     profile.fund     || ''
      };
      console.log('  ' + name + ': ' + (results[j] || []).length + ' records');
    });

    // Pause between batches to be gentle with the API
    if (i + 3 < ALL_INVESTORS.length) await sleep(600);
  }

  const output = { ts: Date.now(), byInvestor };
  fs.writeFileSync('sia-data.json', JSON.stringify(output));
  console.log('\n✓ Saved sia-data.json (' + Object.keys(byInvestor).length + ' investors)');
}

main().catch(function(err) {
  console.error('FATAL ERROR:', err.message);
  process.exit(1);
});
