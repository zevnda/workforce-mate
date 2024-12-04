const fs = require('fs');
const path = require('path');

function copyDirectory(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    entries.forEach(entry => {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirectory(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    });
}

function buildManifest(browser) {
    const browserSpecificManifest = require(`./manifest.${browser}.json`);
    const dirPath = path.join(__dirname, `dist/${browser}`);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(
        path.join(dirPath, 'manifest.json'),
        JSON.stringify(browserSpecificManifest, null, 2)
    );
    const filesToCopy = [
        'background.js',
        'content.js',
    ];
    filesToCopy.forEach(file => {
        fs.copyFileSync(
            path.join(__dirname, file),
            path.join(dirPath, file)
        );
    });
    copyDirectory(path.join(__dirname, 'icons'), path.join(dirPath, 'icons'));
    console.log(`Successfully built ${browser} dist to ${dirPath}`);
}

buildManifest('chrome');
buildManifest('firefox');
