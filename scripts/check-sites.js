// Check that job details can still be read from live job listings, using the same
// extraction code as the extension (sites.js). Run this when a site stops working to see
// which strategies still find each field, or before a release.
//
// Usage: npm run check-sites -- <job listing URL> [<job listing URL> ...]

const { JSDOM } = require('jsdom');
const { JOB_FIELDS, getJobSite, getFetchUrl, extractJobDetails, looksLikeBotChallenge } = require('../sites.js');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';

async function checkUrl(url) {
    console.log(`\n${url}`);

    const site = getJobSite(url);
    const fetchUrl = site && getFetchUrl(site, url);
    if (!fetchUrl) {
        console.log('  FAIL  Not a supported job listing URL');
        return false;
    }
    if (fetchUrl !== url) console.log(`  Fetching ${fetchUrl}`);

    const isJson = site.format === 'json';
    let response;
    try {
        response = await fetch(fetchUrl, {
            headers: { 'User-Agent': USER_AGENT, Accept: isJson ? 'application/json' : 'text/html,application/xhtml+xml' },
            signal: AbortSignal.timeout(15000),
        });
    } catch (error) {
        console.log(`  FAIL  ${site.name}: request failed: ${error.message}`);
        return false;
    }

    const body = await response.text();
    let page;
    if (isJson) {
        console.log(`  ${site.name} | HTTP ${response.status}`);
        if (!response.ok || response.status === 204) {
            console.log('  FAIL  Error or empty response (HTTP 204 means the listing does not exist)');
            return false;
        }
        page = JSON.parse(body);
    } else {
        page = new JSDOM(body).window.document;
        console.log(`  ${site.name} | HTTP ${response.status} | page title: "${page.title}"`);
        if (!response.ok || looksLikeBotChallenge(page)) {
            console.log('  FAIL  Blocked or error page. Note results from here can differ from a browser.');
            return false;
        }
    }

    const { values, sources, attempts } = extractJobDetails(site, page);
    console.table(attempts);

    let ok = true;
    for (const field of JOB_FIELDS) {
        if (values[field]) {
            console.log(`  OK    ${field}: "${values[field]}" (from ${sources[field]})`);
        } else {
            console.log(`  FAIL  ${field}: not found by any strategy`);
            ok = false;
        }
    }
    return ok;
}

async function main() {
    const urls = process.argv.slice(2);
    if (!urls.length) {
        console.error('Usage: npm run check-sites -- <job listing URL> [<job listing URL> ...]');
        process.exit(2);
    }

    let allOk = true;
    for (const url of urls) {
        allOk = (await checkUrl(url)) && allOk;
    }
    process.exit(allOk ? 0 : 1);
}

main();
