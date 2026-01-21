const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);
const buttonId = 'workforce-mate';
const retryInterval = 500;

// Get today's date in DD/MM/YYYY format
const today = new Date();
const day = String(today.getDate()).padStart(2, '0');
const month = String(today.getMonth() + 1).padStart(2, '0');
const year = today.getFullYear();
const formattedDate = `${day}/${month}/${year}`;

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
    description.textContent = 'Paste the URL of a job listing from Seek, Jora, Indeed, CareerOne, or LinkedIn.';
    description.style.cssText = `
        font-size: 16px;
        color: #4F4F4F;
    `;
    
    const { inputDiv, input } = createInput();
    const button = createButton();

    mainDiv.appendChild(label);
    mainDiv.appendChild(description);
    mainDiv.append(flexDiv);
    flexDiv.appendChild(inputDiv);
    flexDiv.appendChild(button);

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

    inputDiv.appendChild(input);

    return { inputDiv, input };
}

// Button element
function createButton() {
    const button = document.createElement('button');
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
    const jobAgent = doc.querySelector('span[data-automation="advertiser-name"]')?.textContent;

    setInputValue('input[name="form.applicationSentDate"]', formattedDate);
    setInputValue('input[name="form.jobTitle"]', jobTitle, 50);
    setInputValue('input[name="form.employerName"]', jobAgent);
    setApplicationMethodValue('Online');
}

function fillFormFromJora(htmlData) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlData, 'text/html');

    const jobTitle = doc.querySelector('h1.job-title')?.textContent;
    const jobAgent = doc.querySelector('span.company')?.textContent;

    setInputValue('input[name="form.applicationSentDate"]', formattedDate);
    setInputValue('input[name="form.jobTitle"]', jobTitle, 50);
    setInputValue('input[name="form.employerName"]', jobAgent);
    setApplicationMethodValue('Online');
}

function fillFormFromIndeed(htmlData) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlData, 'text/html');

    const jobTitle = doc.querySelector('h1.jobsearch-JobInfoHeader-title')?.textContent;
    const jobAgent = doc.querySelector('div[data-testid="inlineHeader-companyName"] a')?.textContent.trim().split('.css')[0];

    setInputValue('input[name="form.applicationSentDate"]', formattedDate);
    setInputValue('input[name="form.jobTitle"]', jobTitle, 50);
    setInputValue('input[name="form.employerName"]', jobAgent);
    setApplicationMethodValue('Online');
}

function fillFormFromLinkedin(htmlData) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlData, 'text/html');

    const jobTitle = doc.querySelector('h3.sub-nav-cta__header')?.textContent;
    const jobAgent = doc.querySelector('a.topcard__org-name-link')?.textContent;

    setInputValue('input[name="form.applicationSentDate"]', formattedDate);
    setInputValue('input[name="form.jobTitle"]', jobTitle, 50);
    setInputValue('input[name="form.employerName"]', jobAgent);
    setApplicationMethodValue('Online');
}

function fillFormFromCareerOne(htmlData) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlData, 'text/html');

    const jobTitle = doc.querySelector('h1.jv-title')?.textContent;
    const jobAgent = doc.querySelector('a.text-title-3.text-black')?.textContent;

    setInputValue('input[name="form.applicationSentDate"]', formattedDate);
    setInputValue('input[name="form.jobTitle"]', jobTitle, 50);
    setInputValue('input[name="form.employerName"]', jobAgent);
    setApplicationMethodValue('Online');
}

// Set input value
function setInputValue(selector, value, maxLength) {
    const input = document.querySelector(selector);
    if (input && value) {
        const newValue = maxLength ? value.slice(0, maxLength).trim() : value.trim();
        
        // Set the value
        input.value = newValue;
        
        // Trigger events to notify the framework
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
    } else {
        console.error(`${selector} not found or value is empty`);
    }
}

// Set select value
function setApplicationMethodValue(value) {
    // Find the dropdown item with the matching text
    const dropdownItems = document.querySelectorAll('.mint-combobox-dropdown .dropdown-item');
    
    for (const item of dropdownItems) {
        const itemText = item.querySelector('.dropdown-item-inner')?.textContent.trim();
        if (itemText === value) {
            // Click the item to trigger the selection
            item.click();
            return;
        }
    }
    
    console.error(`Dropdown option "${value}" not found`);
}

initializeExtension();