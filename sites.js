// Supported job sites and how to read job details from their pages.
//
// Each site has a list of extraction strategies, tried in order. A field is taken from the
// first strategy that finds it, so when a site changes one part of its page another strategy
// can still supply the value. Strategies run against a parsed Document, which lets this file
// be shared by the extension (background.js, content.js) and scripts/check-sites.js in Node.
//
// Optional site settings:
// - toFetchUrl(url): maps the listing URL (a URL object) to the URL to fetch, e.g. a JSON API.
//   Return null if the URL isn't a job listing.
// - format: 'json' to parse the response as JSON, so strategies receive the parsed object
//   instead of a Document. Defaults to 'html'.
//
// When adding a site, also add its domain to the host permissions in both manifests.

const JOB_SITES = [
    {
        name: 'SEEK',
        domains: ['seek.com.au', 'seek.com'],
        strategies: [
            { name: 'JSON-LD JobPosting', extract: fromJsonLd },
            {
                // data-automation attributes are SEEK's test hooks, so they change less than class names
                name: 'SEEK data-automation attributes',
                extract: doc => ({
                    jobTitle: textOf(doc, '[data-automation="job-detail-title"]'),
                    employerName: textOf(doc, '[data-automation="advertiser-name"]'),
                }),
            },
            { name: 'SEEK embedded job data', extract: fromSeekApolloData },
            {
                // e.g. "Harvest Work Job in Cowra, Central West NSW - SEEK"
                name: 'Page title',
                extract: doc => ({ jobTitle: matchGroup(doc.title, /^(.+?) Job in .+ - SEEK$/, 1) }),
            },
        ],
    },
    {
        name: 'Jora',
        domains: ['jora.com'],
        strategies: [
            { name: 'JSON-LD JobPosting', extract: fromJsonLd },
            {
                name: 'Jora page markup',
                extract: doc => ({
                    jobTitle: textOf(doc, 'h1.job-title'),
                    employerName: textOf(doc, '.company'),
                }),
            },
            {
                // e.g. "Residential Cleaner job at Get You Organised in Paddington NSW | Jora"
                name: 'Page title',
                extract: doc => ({
                    jobTitle: matchGroup(doc.title, /^(.+?) job at (.+?) in .+ \| Jora$/, 1),
                    employerName: matchGroup(doc.title, /^(.+?) job at (.+?) in .+ \| Jora$/, 2),
                }),
            },
        ],
    },
    {
        name: 'LinkedIn',
        domains: ['linkedin.com'],
        strategies: [
            { name: 'JSON-LD JobPosting', extract: fromJsonLd },
            {
                name: 'LinkedIn page markup',
                extract: doc => ({
                    jobTitle: textOf(doc, 'h1.top-card-layout__title, .topcard__title, h3.sub-nav-cta__header'),
                    employerName: textOf(doc, 'a.topcard__org-name-link, .topcard__org-name-link'),
                }),
            },
            {
                // LinkedIn serves either of these title formats:
                // "Thrive PR hiring Chief Communications Officer in Sydney, NSW, Australia | LinkedIn"
                // "Chief Communications Officer at Thrive PR — Sydney, NSW, Australia | LinkedIn Jobs"
                name: 'Page title',
                extract: doc => {
                    const hiring = doc.title.match(/^(.+?) hiring (.+) in .+? \| LinkedIn/);
                    if (hiring) return { jobTitle: hiring[2], employerName: hiring[1] };
                    const at = doc.title.match(/^(.+) at (.+?) — .+ \| LinkedIn/);
                    if (at) return { jobTitle: at[1], employerName: at[2] };
                    return {};
                },
            },
        ],
    },
    {
        name: 'Adzuna',
        domains: ['adzuna.com.au'],
        strategies: [
            { name: 'JSON-LD JobPosting', extract: fromJsonLd },
            {
                name: 'Adzuna page markup',
                extract: doc => ({
                    jobTitle: textOf(doc, 'h1'),
                    employerName: textOf(doc, '.ui-company'),
                }),
            },
            {
                // e.g. "Cleaners - adzuna.com.au"
                name: 'Page title',
                extract: doc => ({ jobTitle: matchGroup(doc.title, /^(.+) - adzuna\.com\.au$/, 1) }),
            },
        ],
    },
    {
        // WFA's own listings are rendered client-side, so read the public API their page uses
        name: 'Workforce Australia',
        domains: ['workforceaustralia.gov.au'],
        format: 'json',
        // e.g. /individuals/jobs/details/2353719157 -> /api/v1/global/vacancies/2353719157
        toFetchUrl: url => {
            const vacancyId = url.pathname.match(/\/jobs\/details\/(\d+)/)?.[1];
            return vacancyId ? `${url.origin}/api/v1/global/vacancies/${vacancyId}` : null;
        },
        strategies: [
            {
                name: 'WFA vacancy API',
                extract: vacancy => ({ jobTitle: vacancy.title, employerName: vacancy.employerName }),
            },
        ],
    },
];

const JOB_FIELDS = ['jobTitle', 'employerName'];

// Find the supported site a URL belongs to, or null
function getJobSite(url) {
    let hostname;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        hostname = parsed.hostname.toLowerCase();
    } catch {
        return null;
    }
    return JOB_SITES.find(site =>
        site.domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
    ) || null;
}

// The URL to fetch for a job listing URL, or null if the site doesn't recognise it as a listing
function getFetchUrl(site, url) {
    return site.toFetchUrl ? site.toFetchUrl(new URL(url)) : url;
}

// Run a site's strategies against a parsed page (a Document, or an object for JSON sites).
// Returns { values, sources, attempts } - sources says which strategy supplied each field,
// attempts records what every strategy found (or threw) for debugging.
function extractJobDetails(site, page) {
    const values = {};
    const sources = {};
    const attempts = [];

    for (const strategy of site.strategies) {
        let found = {};
        try {
            found = strategy.extract(page) || {};
        } catch (error) {
            attempts.push({ strategy: strategy.name, error: error.message });
            continue;
        }

        const attempt = { strategy: strategy.name };
        for (const field of JOB_FIELDS) {
            const value = cleanText(found[field]);
            attempt[field] = value || null;
            if (value && !values[field]) {
                values[field] = value;
                sources[field] = strategy.name;
            }
        }
        attempts.push(attempt);
    }

    return { values, sources, attempts };
}

// Detect bot-check / challenge pages that are served with a 200 status
function looksLikeBotChallenge(doc) {
    return /just a moment|attention required|security check|authenticating|verify you are human/i.test(doc.title);
}

// --- Strategy helpers ---

// schema.org JobPosting data, which many job sites embed for search engines
function fromJsonLd(doc) {
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
        let data;
        try {
            data = JSON.parse(script.textContent);
        } catch {
            continue; // Ignore malformed JSON-LD
        }
        const items = [].concat(data).flatMap(item => item?.['@graph'] || [item]);
        const jobPosting = items.find(item => [].concat(item?.['@type']).includes('JobPosting'));
        if (jobPosting) {
            return {
                jobTitle: decodeEntities(doc, jobPosting.title),
                employerName: decodeEntities(doc, jobPosting.hiringOrganization?.name),
            };
        }
    }
    return {};
}

// SEEK embeds its GraphQL cache as `window.SEEK_APOLLO_DATA = {...};` in an inline script
function fromSeekApolloData(doc) {
    const script = [...doc.querySelectorAll('script:not([src])')]
        .find(s => s.textContent.includes('SEEK_APOLLO_DATA'));
    if (!script) return {};

    const json = script.textContent.match(/SEEK_APOLLO_DATA\s*=\s*(\{.*?\});?\s*(?:\n|window\.|$)/s)?.[1];
    if (!json) throw new Error('found SEEK_APOLLO_DATA but could not isolate its JSON');
    const data = JSON.parse(json);

    // Apollo stores objects either inline or as { __ref: "Key" } pointers into the top-level cache
    const resolve = value => (value && value.__ref ? data[value.__ref] : value);
    const job = findObject(data, obj => obj.__typename === 'Job' && obj.title && obj.advertiser, resolve);
    if (!job) return {};

    const advertiser = resolve(job.advertiser);
    // The name key includes query arguments, e.g. name({"locale":"en-AU"})
    const nameKey = advertiser && Object.keys(advertiser).find(key => key === 'name' || key.startsWith('name('));
    return { jobTitle: job.title, employerName: nameKey ? advertiser[nameKey] : undefined };
}

// Depth-first search of a JSON structure for the first object matching a predicate
function findObject(root, predicate, resolve = value => value) {
    const seen = new Set();
    const stack = [root];
    while (stack.length) {
        const value = resolve(stack.pop());
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value);
        if (!Array.isArray(value) && predicate(value)) return value;
        stack.push(...Object.values(value));
    }
    return null;
}

function textOf(doc, selector) {
    return doc.querySelector(selector)?.textContent;
}

function matchGroup(text, regex, group) {
    return text?.match(regex)?.[group];
}

// JSON-LD strings sometimes contain HTML entities such as &amp;
function decodeEntities(doc, text) {
    if (typeof text !== 'string' || !text.includes('&')) return text;
    const textarea = doc.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
}

function cleanText(value) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

// Allow scripts/check-sites.js to use this file in Node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { JOB_SITES, JOB_FIELDS, getJobSite, getFetchUrl, extractJobDetails, looksLikeBotChallenge };
}
