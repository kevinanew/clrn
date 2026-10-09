import { readFileSync } from 'node:fs';
import path from 'node:path';
import { galleryKeyboardScript } from './snapshot-gallery-keyboard';
import { LOCALE_NAMES, MODULE_NAMES } from './snapshot-gallery-model';
import { displayPageName, PAGE_NAME_PARTS } from './snapshot-gallery-names';

export const galleryScript = `
    const PAGE_NAME_PARTS = ${JSON.stringify(PAGE_NAME_PARTS)};
    const displayPageName = ${displayPageName.toString()};
    const moduleNames = ${JSON.stringify(MODULE_NAMES)};
    const localeNames = ${JSON.stringify(LOCALE_NAMES)};
` + readFileSync(path.join(__dirname, 'snapshot-gallery-browser.js'), 'utf8') + galleryKeyboardScript + String.raw`
    readState();
    updateGallery();
`;
