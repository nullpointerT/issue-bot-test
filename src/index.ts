import { install } from "source-map-support";
import { config } from "dotenv";
import Octokit from "@octokit/rest";
import logger from "./logger";
import client from "./client";
import userConfig from "./config";
import { isEmpty, size, includes } from 'lodash';

// Setup env variables and source maps
install();

logger.info("Application has been initialized.");
logger.info("Running in mode %s", process.env.NODE_ENV);

//const dryRunMode = process.env.DRYRUN
const dryRunMode = userConfig.DRYRUN

if (dryRunMode) {
  logger.info("Starting in dryrun mode now")
}

let allLabelsList: Array<any> = []
const CHERRYPICKMSG = '(cherry picked from commit'
const fetchFreq = userConfig.fetchFreq
const issueMaxNoStateTime = userConfig.issueMaxNoStateTime
const issueMaxWaitTimeToRelease = userConfig.issueMaxWaitTimeToRelease

const WEEK_MM = 604800000
const DAY_MM = 86400000
const HR_MM = 3600000

async function getIssues(client: Octokit, pageNum: number, maxPerPage: number) {

  let allIssues: Array<any> = []
  while (true) {
    const { data, status } = await client.issues.listForRepo({
      owner: userConfig.owner,
      repo: userConfig.repo,
      per_page: maxPerPage,
      page: pageNum
    });

    if (status != 200) {
      const error = new Error(`Failed to fetch issues`)
      logger.error("error:", status)
      throw error;
    }

    if (isEmpty(data)) {
      break;
    }

    allIssues = allIssues.concat(data)
    pageNum++
  }

  //fetch reaches the last page
  logger.info("fetch all issus successfully")
  return allIssues;
}

async function getPRs(client: Octokit, pageNum: number, maxPerPage: number) {

  let allPRs: Array<any> = []
  while (true) {
    const { status, data } = await client.pulls.list({
      owner: userConfig.owner,
      repo: userConfig.repo,
      per_page: maxPerPage,
      page: pageNum
    });

    if (status != 200) {
      const error = new Error(`Failed to fetch PRs`)
      logger.error("error:", status)
      throw error;
    }

    if (isEmpty(data)) {
      break;
    }
    allPRs = allPRs.concat(data)
    pageNum++;
  }
  return allPRs;
}

async function getLabelsForRepo(client: Octokit, pageNum: number, maxPerPage: number) {

  let allLabels: Array<any> = []
  while (true) {
    const { status, data } = await client.issues.listLabelsForRepo({
      owner: userConfig.owner,
      repo: userConfig.repo,
      per_page: maxPerPage,
      page: pageNum
    });

    if (status != 200) {
      const error = new Error(`Failed to fetch labels`)
      logger.error("error:", status)
      throw error;
    }

    if (isEmpty(data)) {
      break;
    }
    allLabels = allLabels.concat(data)
    pageNum++;
  }
  return allLabels;
}

async function createIssues(client: Octokit, index: number) {
  const res = await client.issues.create({
    owner: userConfig.owner,
    repo: userConfig.repo,
    title: index + " test creating issue",
  })
  return res
}

async function CommitNotInMaster(client: Octokit, sha: string) {
  let query = "repo:" + userConfig.owner + "/" + userConfig.repo + "+hash:" + sha

  const res = await client.search.commits({
    q: query
  })

  return res.data.items.length == 0
}

async function addComment(client: Octokit, issue: any, comment: string) {
  logger.info("trying to add comment to issue # %d with comment: %s", issue.number, comment)
  if (dryRunMode) {
    return { response: 'dry run mode: add comment' };
  }
  const res = await client.issues.createComment({
    owner: userConfig.owner,
    repo: userConfig.repo,
    issue_number: issue.number,
    body: comment
  });
  return res;
}

async function closeIssue(client: Octokit, issue: any) {
  if (dryRunMode) {
    return { response: 'dry run mode: close issue#' + issue.number };
  }
  const res = await client.issues.update({
    owner: userConfig.owner,
    repo: userConfig.repo,
    issue_number: issue.number,
    state: "closed"
  })
  return res;
}

async function removeALabelFromIssue(client: Octokit, issueNum: number, labelName: string) {
  if (dryRunMode) {
    return;
  }
  const res = await client.issues.removeLabel({
    owner: userConfig.owner,
    repo: userConfig.repo,
    issue_number: issueNum,
    name: labelName
  })
  return res;
}

async function listRefs(client: Octokit) {
  const res = await client.git.listRefs({
    owner: userConfig.owner,
    repo: userConfig.repo
  })
  return res;
}

async function getSinglePullRequest(client: Octokit, prNum: number) {
  const res = await client.pulls.get({
    owner: userConfig.owner,
    repo: userConfig.repo,
    pull_number: prNum
  })
  return res;
}

async function getSingleCommit(client: Octokit, sha: any) {
  const res = await client.repos.getCommit({
    owner: userConfig.owner,
    repo: userConfig.repo,
    sha: sha
  })
  return res;
}

async function getSingleIssue(client: Octokit, issueNum: number) {
  const res = await client.issues.get({
    owner: userConfig.owner,
    repo: userConfig.repo,
    issue_number: issueNum
  })
  return res;
}

// create a label for this repo, can be duplicated
async function createLabel(client: Octokit, name: string, col: string) {
  if (dryRunMode) {
    return;
  }
  const res = await client.issues.createLabel({
    owner: userConfig.owner,
    repo: userConfig.repo,
    name: name,
    color: col
  })
  return res;
}

// events: pinned, unpinned, labeled, unlabeled, etc.
async function listEventForIssue(client: Octokit, issueNum: number) {
  const res = await client.issues.listEvents({
    owner: userConfig.owner,
    repo: userConfig.repo,
    issue_number: issueNum
  })
  return res;
}


async function listCommitsForPR(client: Octokit, pullNum: number) {
  let allCommitsForPR: Array<any> = []
  let pageIndex = 1
  while (true) {
    const { status, data } = await client.pulls.listCommits({
      owner: userConfig.owner,
      repo: userConfig.repo,
      pull_number: pullNum,
      per_page: 100,
      page: pageIndex
    });

    if (status != 200) {
      const error = new Error(`Failed to fetch commits from a PR`)
      logger.error("error:", status)
      throw error;
    }

    if (isEmpty(data)) {
      break;
    }
    allCommitsForPR = allCommitsForPR.concat(data)
    pageIndex++;
  }
  return allCommitsForPR;
}

async function addLabelsToIssue(client: Octokit, issueNum: number, labels: Array<string>) {
  if (dryRunMode) {
    return;
  }
  const res = await client.issues.addLabels({
    owner: userConfig.owner,
    repo: userConfig.repo,
    issue_number: issueNum,
    labels: labels
  })
  return res;
}

async function deleteLabel(client: Octokit, name: string) {
  const res = await client.issues.deleteLabel({
    owner: userConfig.owner,
    repo: userConfig.repo,
    name: name
  })
  return res;
}

function isGreaterThan(end: number, begin: number, unit: string, times: string) {
  if (unit === "") {
    return (end - begin) >= Number(times)
  }
  switch (unit) {
    case 'weeks':
      return (end - begin) >= WEEK_MM * Number(times)
    case 'days':
      return (end - begin) >= DAY_MM * Number(times)
    case 'hours':
      return (end - begin) >= HR_MM * Number(times)
    default:
      return true
  }
}

// go through all labels, check if there is label with prefix, if lableName is empty, check if there is any label
function hasLabelWithPrefix(issue: any, prefix: String) {
  const labelList = issue.labels;
  // no label
  if (isEmpty(labelList)) {
    return false;
  }

  for (let i = 0; i < labelList.length; i++) {
    const name = labelList[i].name;
    if (name.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

function hasFixForIssue(pr: any) {
  if (pr.hasOwnProperty('body')) {
    return pr.body.includes("Fixes #")
  }
  return false;
}

// go through all labels, check if there is label with exact name
function hasLabelWithName(issue: any, name: String) {
  const labelList = issue.labels;
  // no label
  if (isEmpty(labelList)) {
    return false;
  }

  for (let i = 0; i < labelList.length; i++) {
    const eachLabel = labelList[i].name;
    if (name == eachLabel) {
      return true;
    }
  }

  return false;
}

function hasMoreThanOneTargetLabelThenRemove(issue: any, labelName: string) {
  const labelsArray = issue.labels;
  let hasTargetLabel = false;

  labelsArray.forEach((label: any) => {
    if (label.name.includes('Target:')) {
      if (label.name === labelName) {
        if (hasTargetLabel == false) {
          hasTargetLabel = true;
        }
        else {
          removeALabelFromIssue(client, issue.number, label.name).then(response => {
            logger.info("remove label %s for issue/PR #%s", labelName, issue.number)
          }).catch(
            logger.error
          )
        }
      }
      else {
        removeALabelFromIssue(client, issue.number, label.name).then(response => {
          logger.info("remove label %s for issue/PR #%s", labelName, issue.number)
        }).catch(
          logger.error
        )
      }
    }
  })
}

function issuesManagement(response: any) {
  const issuesList = response
  const times1 = issueMaxNoStateTime.substring(0, issueMaxNoStateTime.indexOf(' '))
  const unit1 = issueMaxNoStateTime.substring(issueMaxNoStateTime.indexOf(' ') + 1)
  const times2 = issueMaxWaitTimeToRelease.substring(0, issueMaxWaitTimeToRelease.indexOf(' '))
  const unit2 = issueMaxWaitTimeToRelease.substring(issueMaxWaitTimeToRelease.indexOf(' ') + 1)

  // skip PR, since PR is regarded as an issue as well from github API
  issuesList.filter((issue: any) => !(issue.hasOwnProperty('pull_request'))).forEach((issue: any) => {
    // comment ${uerConfig.askForUpdate} on ticket when no 'State:' labels have been added to an issue in ${issueMaxNoStateTime}
    if (isGreaterThan(Date.now(), new Date(issue.created_at).getTime(), unit1, times1) && !hasLabelWithPrefix(issue, 'State:')) {
      logger.info('Commenting request: asking for update on issue #%s', issue.number)
      addComment(client, issue, userConfig.askForUpdate + ' issue state')
        .then(response => {
          logger.info("added comment on issue #%s", issue.number, response);
        })
        .catch(logger.error)
    }

    // comment ${userConfig.needUpdateFromDeveloper} on ticket when no updates in ${issueMaxNoStateTime} + 1
    // if no label or 'State: Awaiting developer information'
    if ((hasLabelWithName(issue, 'State: Awaiting developer information') || !hasLabelWithName(issue, '')) && isGreaterThan(Date.now(), new Date(issue.created_at).getTime(), unit1, times1 + 1)) {
      logger.info('Commenting request in X+1 weeks: asking for update on issue #%s', issue.number)
      addComment(client, issue, userConfig.needUpdateFromDeveloper)
        .then(response => {
          logger.info("added comment response: %s", response);
        })
        .catch(logger.error)

    }

    // close ticket with note when in state 'State: Awaiting user information' for ${issueMaxNoStateTime}
    if (isGreaterThan(Date.now(), new Date(issue.created_at).getTime(), unit1, times1) && hasLabelWithName(issue, 'State: Awaiting user information')) {

      // need to comment on the issue first and then close it
      addComment(client, issue, userConfig.closeIssueNote)
        .then(response => {
          logger.info("added comment before closing response: %s", response)
        })
        .catch(logger.error)

      closeIssue(client, issue)
        .then(response => {
          logger.info("close issue response: %s", response)
        })
        .catch(logger.error)
    }

    // close ticket when in state 'State: Awaiting merge to rease branches' for more than ${issueMaxWaitTimeToRelease} time
    if (hasLabelWithName(issue, 'State: Awaiting merge to release branches') && isGreaterThan(Date.now(), new Date(issue.created_at).getTime(), unit2, times2) && !hasLabelWithPrefix(issue, 'Target:')) {

      removeALabelFromIssue(client, issue.number, "State: Awaiting merge to release branches")
        .then(response => {
          logger.info("remove label: %s", response)
        })
        .catch(logger.error)

      closeIssue(client, issue)
        .then(response => {
          logger.info("close issue: %s", response)
        })
        .catch(logger.error)
    }
  });

}

async function addTargetLabelForNewPR(pr: any) {
  const unit = fetchFreq.substring(fetchFreq.indexOf(' ') + 1)
  const time = fetchFreq.substring(0, fetchFreq.indexOf(' '))
  let targetLabel = "Target: " + pr.base.ref;
  let newPRlabels: Array<any> = []
  //if new PR(created after the previous management), add label Target: where is the target branch, must make sure the label exists at first
  if (!isGreaterThan(Date.now(), new Date(pr.created_at).getTime(), unit, time)) {
    let labelExists = false;
    allLabelsList.forEach((eachLabel: any) => {
      if (eachLabel.name == targetLabel) {
        labelExists = true;
      }
    });

    if (!labelExists) {
      //need to create the label first
      await createLabel(client, targetLabel, "fbca04").then(
        response => {
          logger.info("create label successfully: %s for pr %s", targetLabel, pr.number);
          allLabelsList.push({ name: targetLabel })
        }).catch(logger.error)
    }

    //add label to this PR
    await addLabelsToIssue(client, pr.number, [targetLabel]).then(
      response => {
        logger.info("added pr #%s with label: %s", pr.number, targetLabel)
        newPRlabels.push({ name: targetLabel })
      }
    ).catch(logger.error);
  } else {
    logger.info("Ignore old PR #%s", pr.number);
  }

  pr.labels.concat(newPRlabels);
  return true;
}

async function reduceTargetLabelForPR(pr: any) {
  let targetLabel = "Target: " + pr.base.ref;
  // remove any labels 'Target: *' except for the one that is 'Target: ' where is the target branch
  if (!isEmpty(pr.labels)) {
    //hasMoreThanOneTargetLabelThenRemove(pr, targetLabel);
    const labelsArray = pr.labels;
    let hasTargetLabel = false;

    for (let i = 0; i < labelsArray.length; i++) {
      let label = labelsArray[i]
      if (label.name.includes('Target:')) {
        if (label.name === targetLabel) {
          if (hasTargetLabel == false) {
            hasTargetLabel = true;
          }
          else {
            await removeALabelFromIssue(client, pr.number, label.name).then(response => {
              logger.info("remove duplicate label %s for issue/PR #%s", label.name, pr.number)
            }).catch(
              logger.error
            )
          }
        }
        else {
          await removeALabelFromIssue(client, pr.number, label.name).then(response => {
            logger.info("remove duplicate label %s for issue/PR #%s", label.name, pr.number)
          }).catch(
            logger.error
          )
        }
      }
    }
  }
  return true;
}

async function removeTargetLabelForPR(pr: any) {
  let targetLabel = "Target: " + pr.base.ref;
  // pr has "Fixes #issueNo", on merge, remove "Target:" from the ticket  
  if (hasFixForIssue(pr) && !pr.body.merged_at) {

    let hasTarget = false
    for (let i = 0; i < pr.labels.length; i++) {
      if (pr.labels[i].name.includes('Target:')) {
        hasTarget = true;
        break;
      }
    }
    if (hasTarget) {
      await removeALabelFromIssue(client, pr.number, targetLabel).then(response => {
        logger.info("remove label %s for PR: %s", targetLabel, pr.number)
      }).catch(logger.error)
    }
  }
  return true;
}

// check if the pr contains commit with 'cherry picked from commit xxxx'
function commentPRContainsCherryPickCommit(pr: any) {

  listCommitsForPR(client, pr.number).then(response => {

    response.forEach(eachCom => {
      if (includes(eachCom.commit.message, CHERRYPICKMSG)) {
        const indexOfSHA = eachCom.commit.message.indexOf(CHERRYPICKMSG);
        //length of SHA is 40
        const SHA = eachCom.commit.message.substring(indexOfSHA + CHERRYPICKMSG.length - 1 + 2, indexOfSHA + CHERRYPICKMSG.length - 1 + 42)
        CommitNotInMaster(client, SHA).then(response => {
          if (response) {
            // not in master
            addComment(client, pr, userConfig.askingForChange)
              .then(response => {
                logger.info("cherry picked msg%s not from master, added comment on pr #%s", eachCom.commit.message, pr.number, response);
              })
              .catch(logger.error)
          }
        }).catch(logger.error)
      }
    })
  }).catch(logger.error);
  return true;
}

function PRsManagement(response: any) {
  const PRList = response;

  PRList.forEach((pr: any) => {
    addTargetLabelForNewPR(pr)
      .catch(logger.error)
      .then(res => reduceTargetLabelForPR(pr))
      .catch(logger.error)
      .then(res => removeTargetLabelForPR(pr))
      .catch(logger.error)
      .then(res => commentPRContainsCherryPickCommit(pr))

    //TODO block PRs in "WIP-DNM"
    if (hasLabelWithName(pr, "⚠️ WIP-DNM!")) {
      /* need the repository owner to set it to protected first
       * https://stackoverflow.com/questions/33442374/use-github-api-to-disable-the-merge-button-on-a-pull-request-and-reenable-it-usi
      */
    }

  });
}

async function main() {

  // fetch all issues 
  logger.info("starting to fetch issues")
  await getIssues(client, 1, 100)
    .then(response => {
      logger.info("all issues length: %d", size(response))
      issuesManagement(response);
    })
    .catch(logger.error);

  // fetch all labels
  logger.info("starting to fetch labels")
  await getLabelsForRepo(client, 1, 100).then(
    response => {
      logger.info("all labels size: %d", size(response))
      allLabelsList = response;
    }
  ).catch(logger.error)

  // fetch all PRs
  logger.info("starting to fetch PRs");
  await getPRs(client, 1, 100)
    .then(response => {
      logger.info("all PRs size: %d", size(response))
      PRsManagement(response)
    })
    .catch(logger.error)
  return null
}

// entry point for AWS Lambda
exports.handler = (event: any) => {
  main();
}
