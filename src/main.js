/* Используемые библиотеки */
const github = require('@actions/github');
const core = require('@actions/core');
const lodash = require('lodash');
const commitChecker = require('@conventional-commits/parser');
const yaml = require('js-yaml');
const fs = require('fs');

/* Встроенные настройки */
const rePrEnding = /\(#(\d+)\)$/;

/* Глобальные данные для выполнения github действия */
let configFile;
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
    try {
        configFile = yaml.load(fs.readFileSync(core.getInput('config-path'), 'utf8'));
    } catch (e) {
        core.warning(e);
    }
}

// Выполнение основной логики github action для создания примечаний к выпуску.
async function main() {
    initVariables();

    const latestTag = await findLatestTag();
    if (latestTag) {
        core.info(`Используется, для поиска истории, тэг: ${latestTag.name}, и SHA: ${latestTag.target.oid}.`);
    } else {
        core.info(`Последний тэг не найден. История формируется на основе коммитов с самого начала.`);
    }

    /* Поиск истории коммитов */
    const commits = await findReleaseCommits(latestTag);
    if (!commits || commits.length < 1) {
        return core.setFailed('Не найдено коммитов с последнего тэга или с начала истории git!');
    }

    // Проверка коммитов на соблюдение стиля оформления сообщений и формирование двух список: обычных коммитов и
    // критическими изменениями.
    const parsedObject = checkingCommitsByConventional(commits);
    if (parsedObject.length < 1) {
        return core.setFailed(
            'С момента предыдущего тега или начала истории git не было проанализировано ни одного допустимого коммита!'
        );
    }

    /* Формирование изменений */
    let changes = generateChanges(parsedObject.commitsParsed);

    /* Формирование критических изменений */
    let breakingChanges = parsedObject.breakingChanges;
    if (breakingChanges.length > 0) {
        changes = generateBreakingChanges(changes, breakingChanges);
    }

    if (changes.length === 0) {
        return core.warning(
            'Нечего добавлять в список изменений из-за списка исключенных типов сообщений коммитов.'
        );
    }

    changes.forEach(change => {
        core.info(`${change}`);
    })

    core.setOutput('changelog', changes.join('\n'));
}

async function findLatestTag() {
    const query = `
        query findLastTag($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            refs(
              last: 1
              refPrefix: "refs/tags/"
            ) {
              nodes {
                name
                target {
                  oid
                }
              }
            }
          }
    }`;

    const tagRaw = await gh.graphql(
        query,
        {
            owner,
            repo
        });

    const tagInfo = lodash.get(tagRaw, 'repository.refs.nodes[0]');
    // noinspection JSUnresolvedVariable
    return !tagInfo ? null : tagInfo;
}

async function findCommitPage(endCursor) {
    let after = endCursor ? `, after: "${endCursor}"` : ``;

    const query = `
        query findCommits($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            ref(qualifiedName: "master") {
              target {
                ... on Commit {
                  history(first: 10${after}) {
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                    edges {
                      node {
                        message
                        oid
                        commitUrl
                        committer {
                          user {
                            login
                            url
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }`;

    const commitHistoryRaw = await gh.graphql(
        query,
        {
            owner,
            repo
        });

    const commitHistory = lodash.get(commitHistoryRaw, 'repository.ref.target.history');
    // noinspection JSUnresolvedVariable
    return commitHistory == null ? null : commitHistory;
}

async function findReleaseCommits(latestTag) {
    const commits = [];
    let hasNextPage = false;
    let pageAfter = null;
    do {
        let commitsHistory = await findCommitPage(pageAfter);
        // noinspection JSUnresolvedVariable
        hasNextPage = commitsHistory.pageInfo.hasNextPage;
        // noinspection JSUnresolvedVariable
        pageAfter = commitsHistory.pageInfo.endCursor;
        // noinspection JSUnresolvedVariable
        for (const commit of commitsHistory.edges) {
            // noinspection JSUnresolvedVariable
            commits.push(commit.node);

            if (latestTag && (latestTag.target.oid === commit.node.oid)) {
                hasNextPage = false;
                break;
            }
        }
    } while (hasNextPage);

    return commits;
}

function checkingCommitsByConventional(commits) {
    const parsed = [];
    const breaking = []
    for (const commit of commits) {
        if (commit.message.includes('skip') || commit.message.includes('skip-ci')) {
            continue;
        }
        try {
            const cAst = commitChecker.toConventionalChangelogFormat(commitChecker.parser(commit.message));
            // noinspection JSUnresolvedVariable
            parsed.push({
                ...cAst,
                sha: commit.oid,
                url: commit.commitUrl,
                author: commit.committer.user.login,
                authorUrl: commit.committer.user.url
            });
            for (const note of cAst.notes) {
                if (note.title === 'BREAKING CHANGE') {
                    // noinspection JSUnresolvedVariable
                    breaking.push({
                        sha: commit.oid,
                        url: commit.commitUrl,
                        subject: cAst.subject,
                        author: commit.committer.user.login,
                        authorUrl: commit.committer.user.url,
                        text: note.text
                    })
                }
            }
            let scope = cAst.scope ? ` в области ${cAst.scope}` : ``;
            core.debug(`[УСПЕХ] Коммит ${commit.oid} типа ${cAst.type}` + scope + ` - ${cAst.subject}`);
        } catch (err) {
            core.warning(
                `[НЕУДАЧА] Пропуск коммита ${commit.oid} поскольку он не соответствует стандартному формату коммита.`
            );
        }
    }
    core.info(`Всего найдено валидных коммитов: ${parsed.length}`);
    core.info(`Всего найдено коммитов с критическими изменениями: ${breaking.length}`);
    return {
        commitsParsed: parsed,
        breakingChanges: breaking
    };
}

function generateChanges(commitsParsed) {
    const changes = [];
    let idx = 0;

    for (const group of configFile.groups) {
        // noinspection JSUnresolvedVariable
        if (lodash.intersection(group.types, configFile.excludeTypes).length > 0) {
            continue;
        }

        const matchingCommits = commitsParsed.filter(commitParsed => group.types.includes(commitParsed.type))
        if (matchingCommits.length < 1) {
            continue;
        }

        if (idx > 0) {
            changes.push('');
        }

        changes.push(useIcons ? `### ${group.icon} ${group.title}` : `### ${group.title}`)
        for (const commit of matchingCommits) {
            const scope = commit.scope ? `**${commit.scope}**: ` : ''
            const subject = buildSubject({
                subject: commit.subject,
                author: commit.author
            })
            changes.push(`- [\`${commit.sha.substring(0, 7)}\`](${commit.url}) - ${scope}${subject}`)
        }
        idx++;
    }
    return changes;
}

function generateBreakingChanges(changes, breakingChanges) {
    changes.push('');
    let breakingChangeTitle = 'КРИТИЧЕСКИЕ ИЗМЕНЕНИЯ';
    changes.push(useIcons ? '### :boom: ' + breakingChangeTitle : '### ' + breakingChangeTitle);
    for (const breakChange of breakingChanges) {
        const body = breakChange.text.split('\n').map(ln => `  ${ln}`).join('  \n');
        const subject = buildSubject({
            subject: breakChange.subject,
            author: breakChange.author
        });
        changes.push(`- из-за [\`${breakChange.sha.substring(0, 7)}\`](${breakChange.url}) - ${subject}:${body}`);
    }

    return changes;
}

function buildSubject({subject, author}) {
    const hasPR = rePrEnding.test(subject);
    let final;
    if (hasPR) {
        final = subject.replace(rePrEnding, prId => {
            return `*(PR #${prId} от @${author})*`;
        });
    } else {
        final = `${subject} *(коммит от @${author})*`;
    }
    return final;
}

main().then(() => console.log("Создание релиза завершено!"));