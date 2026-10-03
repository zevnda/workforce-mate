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
        { urls: ["*://*.seek.com/*", "*://*.seek.com.au/*", "*://*.jora.com/*", "*://*.indeed.com/*"] },
        ["blocking", "responseHeaders"]
    )
};

browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fetchJobData") {
        fetch(request.url)
            .then(response => response.text())
            .then(data => {
                sendResponse({ data: data });
            })
            .catch(error => {
                sendResponse({ error: error.toString() });
            });
        return true;
    }
});