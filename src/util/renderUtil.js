function templateRender(templateFormat, changelog) {
    const resultChangelog = changelog.join('\n');
    return templateFormat ? templateFormat.replace('$changes', resultChangelog) : resultChangelog;
}

export {templateRender}