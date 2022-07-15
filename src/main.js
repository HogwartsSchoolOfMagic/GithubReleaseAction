const github = require('@actions/github');
const core = require('@actions/core');
const lodash = require('lodash');
const commitChecker = require('@conventional-commits/parser');
/*const yaml = require('js-yaml');
const fs   = require('fs');*/

const rePrEnding = /\(#(\d+)\)$/;

const types = [
    {types: ['feat', 'feature'], header: 'Новая функциональность', icon: ':sparkles:'},
    {types: ['fix', 'bugfix'], header: 'Исправление багов', icon: ':bug:'},
    {types: ['perf', 'optimize'], header: 'Повышение производительности', icon: ':zap:'},
    {types: ['refactor', 'code-clean'], header: 'Рефакторинг', icon: ':recycle:'},
    {types: ['test', 'tests'], header: 'Тесты', icon: ':white_check_mark:'},
    {types: ['build', 'ci'], header: 'Сборка системы', icon: ':construction_worker:'},
    {types: ['doc', 'docs'], header: 'Изменения в документации', icon: ':memo:'},
    {types: ['style'], header: 'Изменения стиля кода', icon: ':art:'},
    {types: ['chore'], header: 'Рутина', icon: ':wrench:'},
    {types: ['other'], header: 'Остальные изменения', icon: ':flying_saucer:'}
];

// Выполнение основной логики github action для создания примечаний к выпуску.
async function main() {
    const ghToken = core.getInput('gh-token');
    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;
    const gh = github.getOctokit(ghToken);
    const excludeTypes = (core.getInput('exclude-types') || '').split(',').map(t => t.trim());
    const useIcons = core.getBooleanInput('use-icons');

    const latestTag = await findLatestTag(gh, owner, repo);
    if (latestTag) {
        core.info(`Используется, для поиска истории, тэг: ${latestTag.name}, и SHA: ${latestTag.target.oid}.`);
    } else {
        core.info(`Последний тэг не найден. История формируется на основе коммитов с самого начала.`);
    }

    /* Поиск истории коммитов */
    const commits = await findReleaseCommits(gh, owner, repo, latestTag);
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
    const changes = generateChanges(excludeTypes, parsedObject.commitsParsed, useIcons);

    /* Формирование критических изменений */
    let breakingChanges = parsedObject.breakingChanges;
    if (breakingChanges.length > 0) {
        generateBreakingChanges();
    }

    if (changes.length > 0) {
        changes.push('');
    } else {
        return core.warning(
            'Нечего добавлять в список изменений из-за списка исключенных типов сообщений коммитов.'
        );
    }

    changes.forEach(change => {
        core.info(`${change}`);
    })

    core.setOutput('changelog', changes.join('\n'));
}

async function findLatestTag(gh, owner, repo) {
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

async function findCommitPage(gh, owner, repo, endCursor) {
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
                        messageHeadline
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

async function findReleaseCommits(gh, owner, repo, latestTag) {
    const commits = [];
    let hasNextPage = false;
    let pageAfter = null;
    do {
        let commitsHistory = await findCommitPage(gh, owner, repo, pageAfter);
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
        try {
            // noinspection JSUnresolvedVariable
            const cAst = commitChecker.toConventionalChangelogFormat(commitChecker.parser(commit.messageHeadline));
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
                    breaking.push({
                        sha: commit.sha,
                        url: commit.html_url,
                        subject: cAst.subject,
                        author: commit.author.login,
                        authorUrl: commit.author.html_url,
                        text: note.text
                    })
                }
            }
            core.info(`[УСПЕХ] Коммит ${commit.oid} типа ${cAst.type} в области ${cAst.scope} - ${cAst.subject}`);
        } catch (err) {
            core.warning(
                `[НЕУДАЧА] Пропуск коммита ${commit.oid} поскольку он не соответствует стандартному формату коммита.`
            );
        }
    }
    return {
        commitsParsed: parsed,
        breakingChanges: breaking
    };
}

function generateChanges(excludeTypes, commitsParsed, useIcons) {
    const changes = [];
    let idx = 0;

    // Get document, or throw exception on error
    /*let doc;
    try {
        doc = yaml.load(fs.readFileSync('./config/default-config.yml', 'utf8'));
        console.log(JSON.stringify(doc));
    } catch (e) {
        console.log(e);
        return;
    }*/

    for (const type of types) {
        if (lodash.intersection(type.types, excludeTypes).length > 0) {
            continue;
        }

        const matchingCommits = commitsParsed.filter(commitParsed => type.types.includes(commitParsed.type))
        if (matchingCommits.length < 1) {
            continue;
        }

        if (idx > 0) {
            changes.push('');
        }

        changes.push(useIcons ? `### ${type.icon} ${type.header}` : `### ${type.header}`)
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

function generateBreakingChanges(changes, breakingChanges, useIcons) {
    changes.push('')
    let breakingChangeTitle = 'КРИТИЧЕСКИЕ ИЗМЕНЕНИЯ';
    changes.push(useIcons ? '### :boom: ' + breakingChangeTitle : '### ' + breakingChangeTitle);
    for (const breakChange of breakingChanges) {
        const body = breakChange.text.split('\n').map(ln => `  ${ln}`).join('  \n');
        const subject = buildSubject({
            subject: breakChange.subject,
            author: breakChange.author
        });
        changes.push(`- из-за [\`${breakChange.sha.substring(0, 7)}\`](${breakChange.url}) - ${subject}:\n\n${body}\n`);
    }
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