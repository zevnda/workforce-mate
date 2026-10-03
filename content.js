// Relies on sites.js, which the manifest loads before this file
const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);
const buttonId = 'workforce-mate';
const retryInterval = 500;

const log = {
    info: (...args) => console.info('[Workforce Mate]', ...args),
    warn: (...args) => console.warn('[Workforce Mate]', ...args),
    error: (...args) => console.error('[Workforce Mate]', ...args),
};

// Form field selectors - IEA participants use form.<field>, regular WFA uses form.submissionData.<field>
const fieldSelectors = {
    applicationSentDate: 'input[name="form.applicationSentDate"], input[name="form.submissionData.applicationSentDate"]',
    jobTitle: 'input[name="form.jobTitle"], input[name="form.submissionData.jobTitle"]',
    employerName: 'input[name="form.employerName"], input[name="form.submissionData.employerName"]',
    isAdvertised: 'input[name="form.submissionData.isAdvertised"]',
};

const fieldLabels = { jobTitle: 'job title', employerName: 'employer name' };
const jobTitleMaxLength = 50;

// An error with a message that is safe and useful to show the user
class FillError extends Error {
    constructor(userMessage, details) {
        super(details || userMessage);
        this.userMessage = userMessage;
    }
}

// Get today's date in DD/MM/YYYY format
function getFormattedDate() {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${today.getFullYear()}`;
}

// Initialize the extension
function initializeExtension() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => addDivToForm());
    } else {
        addDivToForm();
    }
}

// Add new div to form - retry if form not found
function addDivToForm() {
    const form = document.querySelector('.form');
    if (!form) {
        setTimeout(() => addDivToForm(), retryInterval);
        return;
    }

    if (!document.getElementById(buttonId)) {
        const newDiv = createFormFillerElements();
        form.insertBefore(newDiv.mainDiv, form.firstChild);

        setTimeout(() => newDiv.input.focus(), 0);
    }

    // Continue checking to re-add if form is reset/reloaded
    setTimeout(() => addDivToForm(), retryInterval);
}

// Main div element
function createFormFillerElements() {
    const mainDiv = document.createElement('div');
    mainDiv.style.cssText = 'display: flex; flex-direction: column; gap: 2px; margin-top: 16px; margin-bottom: 16px;';
    mainDiv.id = buttonId;

    const flexDiv = document.createElement('div');
    flexDiv.style.cssText = 'display: flex; gap: 6px; ';

    const label = createLabel();

    const description = document.createElement('p');
    description.textContent = `Paste the URL of a job listing from ${formatList(JOB_SITES.map(site => site.name))}.`;
    description.style.cssText = `
        font-size: 16px;
        color: #4F4F4F;
    `;

    const { inputDiv, input } = createInput();
    const button = createButton();
    const status = createStatus();

    mainDiv.appendChild(label);
    mainDiv.appendChild(description);
    mainDiv.append(flexDiv);
    flexDiv.appendChild(inputDiv);
    flexDiv.appendChild(button);
    mainDiv.appendChild(status);

    // Add divider below the main div
    const divider = document.createElement('div');
    divider.style.cssText = 'width: 100%; height: 1px; background-color: #E0E0E0; margin-top: 16px;';
    mainDiv.appendChild(divider);

    return { mainDiv, inputDiv, input };
}

// Label element
function createLabel() {
    const label = document.createElement('p');
    label.textContent = 'Job Listing URL';
    label.style.cssText = 'font: 16px "Public Sans", sans-serif; font-weight: 700; color: #05154D; margin-bottom: 6px;';
    return label;
}

// Input element
function createInput() {
    const inputDiv = document.createElement('div');
    inputDiv.style.cssText = 'width: 100%';

    const input = document.createElement('input');
    input.style.cssText = `
        background-color: #fff;
        border: 1px solid #848484;
        border-radius: 8px;
        padding: 8px 16px;
        font-size: 14px;
        align-items: center;
        height: 47px;
        width: 100%;
    `;

    // Submit with Enter, without submitting the WFA form itself
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleButtonClick(e);
    });

    inputDiv.appendChild(input);

    return { inputDiv, input };
}

// Button element
function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Fill Form';
    button.style.cssText = `
        background-color: #0076BD;
        color: white;
        border: none;
        border-radius: 999px;
        padding: 10px 10px;
        font-family: inherit;
        font-size: 16px;
        font-weight: bold;
        line-height: 1.5;
        cursor: pointer;
        display: flex;
        align-items: center;
        height: 47px;
        min-width: fit-content;
        user-select: none;
    `;
    button.addEventListener('click', handleButtonClick);
    return button;
}

// Status message element, shown below the input
function createStatus() {
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.style.cssText = 'font-size: 14px; margin-top: 6px; display: none;';
    return status;
}

const statusColors = { info: '#4F4F4F', success: '#1E7D32', warning: '#9A5B00', error: '#B3261E' };

function showStatus(message, type = 'info') {
    const status = document.querySelector(`#${buttonId} [role="status"]`);
    if (!status) return;
    status.textContent = message;
    status.style.color = statusColors[type];
    status.style.display = message ? 'block' : 'none';
}

function setBusy(busy) {
    const button = document.querySelector(`#${buttonId} button`);
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? 'Filling...' : 'Fill Form';
    button.style.opacity = busy ? '0.7' : '1';
    button.style.cursor = busy ? 'wait' : 'pointer';
}

// Handle button click
async function handleButtonClick(e) {
    e.preventDefault();
    const input = document.querySelector(`#${buttonId} input`);
    const url = input.value.trim();

    if (!url) {
        showStatus('Paste a job listing URL first.', 'error');
        return;
    }

    const site = getJobSite(url);
    if (!site) {
        log.warn('Unsupported or invalid URL:', url);
        showStatus(`That isn't a job listing URL from a supported site (${formatList(JOB_SITES.map(s => s.name))}).`, 'error');
        return;
    }

    setBusy(true);
    showStatus(`Fetching job details from ${site.name}...`);

    try {
        const html = await fetchJobPage(url, site);
        const doc = new DOMParser().parseFromString(html, 'text/html');

        if (looksLikeBotChallenge(doc)) {
            throw new FillError(
                `${site.name} showed a bot check instead of the job listing. Please fill in the job details manually.`,
                `Bot challenge page received from ${url} (page title: "${doc.title}")`
            );
        }

        const job = extractJobDetails(site, doc);
        logExtraction(site, url, doc, job);

        const problems = fillForm(job.values);
        if (problems.length) {
            showStatus(`Form partly filled. ${problems.join(' ')}`, 'warning');
        } else {
            showStatus(`Filled from ${site.name}: ${job.values.jobTitle} at ${job.values.employerName}. Check the details before submitting.`, 'success');
        }
    } catch (error) {
        log.error(error.message, error);
        showStatus(error.userMessage || 'Something went wrong filling the form. See the browser console for details.', 'error');
    } finally {
        setBusy(false);
    }
}

// Fetch the job page HTML via the background script, which can make cross-site requests
async function fetchJobPage(url, site) {
    let response;
    try {
        response = await browserAPI.runtime.sendMessage({ action: 'fetchJobData', url });
    } catch (error) {
        // Happens after the extension is updated or reloaded while this page is open
        throw new FillError('Workforce Mate was updated or reloaded. Refresh this page and try again.', `sendMessage failed: ${error.message}`);
    }

    if (!response) {
        throw new FillError('Workforce Mate had an internal error. Refresh this page and try again.', 'Empty response from background script');
    }
    if (response.error) {
        throw new FillError(describeFetchError(site, response.status), response.error);
    }
    return response.data;
}

function describeFetchError(site, status) {
    if (status === 'timeout') return `${site.name} took too long to respond. Try again in a moment.`;
    if (status === 404 || status === 410) return `${site.name} couldn't find that job listing. It may have expired or been removed.`;
    if ([401, 403, 429, 503, 999].includes(status)) {
        return `${site.name} blocked the request (HTTP ${status}), probably with bot protection. Please fill in the job details manually.`;
    }
    if (typeof status === 'number') return `${site.name} returned an error (HTTP ${status}). Try again in a moment.`;
    return `Couldn't load the job listing from ${site.name}. Check your internet connection and try again.`;
}

// Log what was extracted and how, so a broken site is easy to diagnose from the console
function logExtraction(site, url, doc, job) {
    const missing = JOB_FIELDS.filter(field => !job.values[field]);
    const summary = `${site.name}: ${missing.length ? `could not find ${missing.join(', ')}` : 'found all job details'}`;
    const logFn = missing.length ? log.warn : log.info;

    logFn(summary, { url, pageTitle: doc.title, values: job.values, sources: job.sources });
    if (missing.length) {
        // Every strategy's result shows which part of the site's page has changed
        console.table(job.attempts);
    }
}

// Fill the WFA form. Returns a list of user-facing problems, empty if everything was filled.
function fillForm(values) {
    const problems = [];

    // Form fields missing means the WFA form itself has changed
    const missingInputs = ['applicationSentDate', 'jobTitle', 'employerName']
        .filter(field => !document.querySelector(fieldSelectors[field]));
    if (missingInputs.length) {
        log.error('WFA form fields not found:', missingInputs.map(field => fieldSelectors[field]));
        throw new FillError(
            "Couldn't find the job search form fields on this page. Workforce Australia may have changed the form.",
            `Form fields not found: ${missingInputs.join(', ')}`
        );
    }

    setInputValue(fieldSelectors.applicationSentDate, getFormattedDate());

    const unfilled = JOB_FIELDS.filter(field => !values[field]);
    for (const field of JOB_FIELDS) {
        if (values[field]) setInputValue(fieldSelectors[field], values[field], field === 'jobTitle' ? jobTitleMaxLength : undefined);
    }
    if (unfilled.length) {
        problems.push(`Couldn't read the ${formatList(unfilled.map(field => fieldLabels[field]), 'and')} from the listing, so please fill ${unfilled.length > 1 ? 'them' : 'it'} in.`);
    }

    if (!setApplicationMethodValue('Online')) {
        problems.push('Please select the application method.');
    }
    setCheckboxChecked(fieldSelectors.isAdvertised);

    return problems;
}

// Set input value
function setInputValue(selector, value, maxLength) {
    const input = document.querySelector(selector);
    if (!input || !value) {
        log.error(`${selector} not found or value is empty`);
        return false;
    }

    // Respect the form's own maxlength as well as ours
    const limits = [maxLength, input.maxLength > 0 ? input.maxLength : undefined].filter(Boolean);
    const newValue = limits.length ? value.slice(0, Math.min(...limits)).trim() : value.trim();

    // Set the value
    input.value = newValue;

    // Trigger events to notify the framework
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
}

// Check a checkbox if it exists - optional field, not present on every form
function setCheckboxChecked(selector) {
    const checkbox = document.querySelector(selector);
    if (checkbox && !checkbox.checked) {
        // Click rather than set .checked so the framework registers the change
        checkbox.click();
    }
}

// Set select value. Returns whether the option was found.
function setApplicationMethodValue(value) {
    // Find the dropdown item with the matching text
    const dropdownItems = [...document.querySelectorAll('.mint-combobox-dropdown .dropdown-item')];
    const optionText = item => item.querySelector('.dropdown-item-inner')?.textContent.trim();

    const match = dropdownItems.find(item => optionText(item) === value);
    if (match) {
        // Click the item to trigger the selection
        match.click();
        return true;
    }

    log.error(`Application method option "${value}" not found. Options on the page:`, dropdownItems.map(optionText));
    return false;
}

// "a", "a or b", "a, b, or c"
function formatList(items, conjunction = 'or') {
    if (items.length <= 2) return items.join(` ${conjunction} `);
    return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

initializeExtension();
