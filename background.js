const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

// Chrome loads this as a service worker, so pull in the site list here.
// Firefox loads sites.js before this file via the manifest's background scripts.
if (typeof importScripts === 'function') {
    importScripts('sites.js');
}

const FETCH_TIMEOUT_MS = 15000;

browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action !== 'fetchJobData') return false;

    fetchJobPage(request.url)
        .then(sendResponse)
        .catch(error => {
            console.error('[Workforce Mate] Fetch failed:', error);
            sendResponse({ error: error.message, status: error.status ?? null });
        });
    return true; // Keep the message channel open for the async response
});

async function fetchJobPage(listingUrl) {
    // Only fetch from supported job sites, never arbitrary URLs passed in from a page
    const site = getJobSite(listingUrl);
    const url = site && getFetchUrl(site, listingUrl);
    if (!url) {
        throw new Error(`Refusing to fetch unsupported URL: ${listingUrl}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        // Omit cookies so sites return their public job page, not the logged-in version
        const response = await fetch(url, {
            credentials: 'omit',
            signal: controller.signal,
            headers: { Accept: site.format === 'json' ? 'application/json' : 'text/html,application/xhtml+xml' },
        });
        if (!response.ok) {
            throw Object.assign(new Error(`HTTP ${response.status} fetching ${url}`), { status: response.status });
        }
        // The WFA vacancy API answers an unknown or removed listing with 204 No Content
        if (response.status === 204) {
            throw Object.assign(new Error(`No content (HTTP 204) fetching ${url}`), { status: 404 });
        }
        return { data: await response.text(), finalUrl: response.url };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw Object.assign(new Error(`Timed out after ${FETCH_TIMEOUT_MS / 1000}s fetching ${url}`), { status: 'timeout' });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}
