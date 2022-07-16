/* Используемые внешние библиотеки */
const commitChecker = require('@conventional-commits/parser');
const core = require('@actions/core');
const lodash = require("lodash");

/* Используемые свои библиотеки */
const githubApi = require('../api/githubApi');

/* Встроенные настройки */
const rePrEnding = /\(#(\d+)\)$/;

function generateChanges(configFile, commitsParsed, useIcons) {
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

function generateBreakingChanges(changes, breakingChanges, useIcons) {
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

async function findReleaseCommits(gh, owner, repo, latestTag) {
    const commits = [];
    let hasNextPage = false;
    let pageAfter = null;
    do {
        let commitsHistory = await githubApi.findCommitPage(gh, owner, repo, pageAfter);
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
    core.debug(`Всего найдено валидных коммитов: ${parsed.length}`);
    core.debug(`Всего найдено коммитов с критическими изменениями: ${breaking.length}`);
    return {
        commitsParsed: parsed,
        breakingChanges: breaking
    };
}

export {generateChanges, generateBreakingChanges, findReleaseCommits, checkingCommitsByConventional}