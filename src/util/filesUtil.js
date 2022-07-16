/* Используемые внешние библиотеки */
const core = require('@actions/core');
const yaml = require('js-yaml');
const fs = require('fs');

function getFileByPath(filePath) {
    try {
        // noinspection JSCheckFunctionSignatures
        return yaml.load(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        core.warning(e);
        return null;
    }
}

export {getFileByPath}