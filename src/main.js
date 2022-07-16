/* Используемые внешние библиотеки */
const github = require('@actions/github');
const core = require('@actions/core');

/* Используемые свои библиотеки */
let { configFile } = require('./config/defaultConfig');
const githubApi = require('./api/githubApi');
const changelogUtil = require('./util/changelogUtil');
const filesUtil = require('./util/filesUtil');
const renderUtil = require('./util/renderUtil');

/* Глобальные данные для выполнения github действия */
let owner;
let repo;
let gh;
let useIcons;

function initVariables() {
    owner = github.context.repo.owner;
    repo = github.context.repo.repo;
    gh = github.getOctokit(core.getInput('gh-token'));
    useIcons = core.getBooleanInput('use-icons');

    /* Получение конфигурационного файла */
    const configPath = core.getInput('config-path');
    if (configPath) {
        configFile = filesUtil.getFileByPath(configPath);
    }
}

// Выполнение основной логики github action для создания примечаний к выпуску.
async function main() {
    initVariables();
    if (configFile == null) {
        return core.setFailed(`Ошибка чтения своего файла конфигурации!`);
    }

    const latestTag = await githubApi.findLatestTag(gh, owner, repo);
    if (latestTag) {
        core.debug(`Используется, для поиска истории, тэг: ${latestTag.name}, и SHA: ${latestTag.target.oid}.`);
    } else {
        core.debug(`Последний тэг не найден. История формируется на основе коммитов с самого начала.`);
    }

    /* Поиск истории коммитов */
    const commits = await changelogUtil.findReleaseCommits(gh, owner, repo, latestTag);
    if (!commits || commits.length < 1) {
        return core.setFailed('Не найдено коммитов с последнего тэга или с начала истории git!');
    }

    // Проверка коммитов на соблюдение стиля оформления сообщений и формирование двух список: обычных коммитов и
    // критическими изменениями.
    const parsedObject = changelogUtil.checkingCommitsByConventional(commits);
    if (parsedObject.length < 1) {
        return core.setFailed(
            'С момента предыдущего тега или начала истории git не было проанализировано ни одного допустимого коммита!'
        );
    }

    const prevVersionRelease = latestTag ? latestTag.name : null;
    const newVersionRelease = changelogUtil.calculateVersionNumber(parsedObject, configFile, prevVersionRelease);
    core.info(`Версия нового релиза: ${newVersionRelease}`);

    /* Формирование изменений */
    let changes = changelogUtil.generateChanges(configFile, parsedObject.commitsParsed, useIcons);

    /* Формирование критических изменений */
    let breakingChanges = parsedObject.breakingChanges;
    if (breakingChanges.length > 0) {
        changes = changelogUtil.generateBreakingChanges(changes, breakingChanges, useIcons);
    }

    if (changes.length === 0) {
        return core.warning(
            'Нечего добавлять в список изменений из-за списка исключенных типов сообщений коммитов.'
        );
    }

    const resultReleaseNotes = renderUtil.templateRender(configFile.template, changes);
    core.info(`${resultReleaseNotes}`);
    core.setOutput('changelog', resultReleaseNotes);
}

main().then(() => core.debug("Создание релиза завершено!"));