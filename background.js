const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

// Required for Firefox compat
if (browserAPI.webRequest) {
    browserAPI.webRequest.onHeadersReceived.addListener(
        (details) => {
            let headers = details.responseHeaders;
            headers.push({
                name: "Access-Control-Allow-Origin",
                value: "*"
            });
            return { responseHeaders: headers };
        },
        { urls: ["*://*.seek.com/*", "*://*.seek.com.au/*", "*://*.jora.com/*"] },
        ["blocking", "responseHeaders"]
    )
};

browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchJobData") {
        // Omit cookies so sites return their public job page, not the logged-in version
        fetch(request.url, { credentials: 'omit' })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${request.url}`);
                return response.text();
            })
            .then(data => {
                sendResponse({ data: data });
            })
            .catch(error => {
                sendResponse({ error: error.toString() });
            });
        return true;
    }
});