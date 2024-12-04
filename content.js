const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);
const buttonId = 'workforce-mate';
const retryInterval = 500;

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
    const form = document.querySelector('.container-fluid');
    if (!form) {
        setTimeout(() => addDivToForm(), retryInterval);
        return;
    }

    if (!document.getElementById(buttonId)) {
        const newDiv = createFormFillerElements();
        form.insertBefore(newDiv.mainDiv, form.firstChild);

        // Close the annoying calender UI that is always open by default
        const calenderDiv = document.getElementById('ui-datepicker-div');
        calenderDiv.style.display = 'none';

        setTimeout(() => newDiv.input.focus(), 0);
    }

    setTimeout(() => addDivToForm(), retryInterval);
}

// Main div element
function createFormFillerElements() {
    const mainDiv = document.createElement('div');
    mainDiv.style.cssText = 'display: flex; flex-direction: column; gap: 2px;';
    mainDiv.id = buttonId;

    const flexDiv = document.createElement('div');
    flexDiv.style.cssText = 'display: flex; gap: 6px; ';

    const divider = document.createElement('div');
    divider.style.cssText = 'width: 100%; height: 1px; background-color: #dadada; margin-top: 10px; margin-bottom: 20px;';

    const label = createLabel();
    const { inputDiv, input } = createInput();
    const button = createButton();

    mainDiv.appendChild(label);
    mainDiv.append(flexDiv);
    flexDiv.appendChild(inputDiv);
    flexDiv.appendChild(button);
    mainDiv.appendChild(divider);

    return { mainDiv, inputDiv, input };
}

// Label element
function createLabel() {
    const label = document.createElement('p');
    label.textContent = 'Job Listing URL';
    label.style.cssText = 'font: 16px "Public Sans", sans-serif; font-weight: 500; margin-bottom: 6px;';
    return label;
}

// Input element
function createInput() {
    const inputDiv = document.createElement('div');
    inputDiv.style.cssText = 'width: 100%';

    const input = document.createElement('input');
    input.style.cssText = `
        background-color: #fff;
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 8px 16px;
        font-size: 14px;
        align-items: center;
        height: 36px;
        width: 100%;
    `;

    const description = document.createElement('p');
    description.textContent = 'Paste the URL of a job listing from Seek, Jora, Indeed, or LinkedIn.';
    description.style.cssText = `
        margin-top: 4px;
        font-size: 11px;
        color: #666;
    `;

    inputDiv.appendChild(input);
    inputDiv.appendChild(description);

    return { inputDiv, input };
}

// Button element
function createButton() {
    const button = document.createElement('button');
    button.textContent = 'Fill Form';
    button.style.cssText = `
        background-color: #00a1d0;
        color: white;
        border: none;
        border-radius: 3px;
        padding: 5px 10px;
        font-family: inherit;
        font-size: 14px;
        font-weight: normal;
        line-height: 1.5;
        cursor: pointer;
        display: flex;
        align-items: center;
        height: 36px;
        min-width: fit-content;
        user-select: none;
    `;
    button.addEventListener('click', handleButtonClick);
    return button;
}

// Handle button click
async function handleButtonClick(e) {
    e.preventDefault();
    const input = document.querySelector(`#${buttonId} input`);
    const url = input.value.trim();

    if (!url) {
        console.error('Please enter a valid URL');
        return;
    }

    try {
        const jobData = await fetchJobData(url);

        if (url.includes('seek.com.au/')) fillFormFromSeek(jobData);
        if (url.includes('au.jora.com/')) fillFormFromJora(jobData);
        if (url.includes('au.indeed.com/')) fillFormFromIndeed(jobData);
        if (url.includes('linkedin.com/')) fillFormFromLinkedin(jobData);
        if (url.includes('careerone.com.au/')) fillFormFromCareerOne(jobData);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Fetch job data
function fetchJobData(url) {
    return new Promise((resolve, reject) => {
        browserAPI.runtime.sendMessage({ action: "fetchJobData", url }, response => {
            if (browserAPI.runtime.lastError) {
                console.error('Runtime error:', browserAPI.runtime.lastError);
                reject(new Error(browserAPI.runtime.lastError.message));
            } else if (response && response.error) {
                console.error('Response error:', response.error);
                reject(new Error(response.error));
            } else if (response && response.data) {
                resolve(response.data);
            } else {
                console.error('Invalid response:', response);
                reject(new Error("Invalid response"));
            }
        });
    });
}

// Fill form with job data
function fillFormFromSeek(htmlData) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlData, 'text/html');

    const jobTitle = doc.querySelector('h1[data-automation="job-detail-title"]')?.textContent;
    const jobLocation = doc.querySelector('span[data-automation="job-detail-location"]')?.textContent;
    const jobAgent = doc.querySelector('span[data-automation="advertiser-name"]')?.textContent;

    setInputValue('input[name="JobTitle"]', jobTitle, 50);
    setInputValue('input[name="JobLocation"]', jobLocation);
    setInputValue('input[name="AgentName"]', jobAgent);
    setInputValue('input[name="EmployerContact"]', 'Online');
    setSelectValue('select[name="ApplicationMethod"]', 'ONEX');
}

function fillFormFromJora(htmlData) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlData, 'text/html');

    const jobTitle = doc.querySelector('h1.job-title')?.textContent;
    const jobLocation = doc.querySelector('span.location')?.textContent;
    const jobAgent = doc.querySelector('span.company')?.textContent;

    setInputValue('input[name="JobTitle"]', jobTitle, 50);
    setInputValue('input[name="JobLocation"]', jobLocation);
    setInputValue('input[name="AgentName"]', jobAgent);
    setInputValue('input[name="EmployerContact"]', 'Online');
    setSelectValue('select[name="ApplicationMethod"]', 'ONEX');
}

function fillFormFromIndeed(htmlData) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlData, 'text/html');

    const jobTitle = doc.querySelector('h1.jobsearch-JobInfoHeader-title')?.textContent;
    const jobLocation = doc.querySelector('div[data-testid="inlineHeader-companyLocation"]')?.textContent;
    const jobAgent = doc.querySelector('div[data-testid="inlineHeader-companyName"] a')?.textContent.trim().split('.css')[0];

    setInputValue('input[name="JobTitle"]', jobTitle, 50);
    setInputValue('input[name="JobLocation"]', jobLocation);
    setInputValue('input[name="AgentName"]', jobAgent);
    setInputValue('input[name="EmployerContact"]', 'Online');
    setSelectValue('select[name="ApplicationMethod"]', 'ONEX');
}

function fillFormFromLinkedin(htmlData) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlData, 'text/html');

    const jobTitle = doc.querySelector('h3.sub-nav-cta__header')?.textContent;
    const jobLocation = doc.querySelector('span.sub-nav-cta__meta-text')?.textContent;
    const jobAgent = doc.querySelector('a.topcard__org-name-link')?.textContent;

    setInputValue('input[name="JobTitle"]', jobTitle, 50);
    setInputValue('input[name="JobLocation"]', jobLocation);
    setInputValue('input[name="AgentName"]', jobAgent);
    setInputValue('input[name="EmployerContact"]', 'Online');
    setSelectValue('select[name="ApplicationMethod"]', 'ONEX');
}

function fillFormFromCareerOne(htmlData) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlData, 'text/html');

    const jobTitle = doc.querySelector('h1.jv-title')?.textContent;
    const jobLocation = doc.querySelector('a.text-dark-500[title]')?.textContent;
    const jobAgent = doc.querySelector('a.text-title-3.text-black')?.textContent;

    setInputValue('input[name="JobTitle"]', jobTitle, 50);
    setInputValue('input[name="JobLocation"]', jobLocation);
    setInputValue('input[name="AgentName"]', jobAgent);
    setInputValue('input[name="EmployerContact"]', 'Online');
    setSelectValue('select[name="ApplicationMethod"]', 'ONEX');
}

// Set input value
function setInputValue(selector, value, maxLength) {
    const input = document.querySelector(selector);
    if (input && value) {
        input.value = maxLength ? value.slice(0, maxLength).trim() : value.trim();
    } else {
        console.error(`${selector} not found or value is empty`);
    }
}

// Set select value
function setSelectValue(selector, value) {
    const select = document.querySelector(selector);
    if (select) {
        select.value = value;
    } else {
        console.error(`${selector} not found`);
    }
}

initializeExtension();