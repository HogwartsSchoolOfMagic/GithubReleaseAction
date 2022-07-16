/* Используемые внешние библиотеки */
const lodash = require("lodash");

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

export {findLatestTag, findCommitPage}