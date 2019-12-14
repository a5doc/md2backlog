const marked = require('marked');
const slugger = new marked.Slugger();
const prettier = require('prettier');
const fs = require('fs');
const yaml = require('js-yaml');
const moment = require('moment');
const frontMatter = require('front-matter');
const path = require('path');

require('isomorphic-form-data');
require('isomorphic-fetch');
const es6promise = require('es6-promise');
const backlogjs = require('backlog-js');

es6promise.polyfill();


class Page {
  constructor() {
    this.size = 20;
    this.offset = -1;
    this.nextOffset = 0;
    this.elements = null;
  }

  hasNext() {
    return this.offset == -1 || this.offset != this.nextOffset;
  }
}

let backlog;
let config;

async function putBacklog(config, mdFile) {
  backlog = createBacklog(config);
  const doc = readMd(mdFile);
  const project = await findProject();
  const responsDoc = await putPost(project.id, doc);
  const mergedAttributes = Object.assign(doc.attributes, {
    docId: responsDoc.docId,
    title: responsDoc.title,
    url: genarateUrl(responsDoc.docId),
    updated: responsDoc.updated,
  });
  writeMd({
    file: mdFile,
    attributes: mergedAttributes,
    content: responsDoc.content,
    updated: moment().toISOString(),
  });
}
module.exports.putBacklog = putBacklog;

async function fromBacklog(config) {
  backlog = createBacklog(config);
  const project = await findProject();
  let page = new Page();
  const index = [];
  while (page.hasNext()) {
    page = await fetchPosts(project.id, page);
    page.elements.forEach(element => {
      const newMdName = genarateMdFileName(element.docId, element.title);
      const doc = {
        file: newMdName.file,
        sortKey: element.title.toUpperCase(),
        attributes: {
          docId: element.docId,
          title: element.title,
          url: genarateUrl(element.docId),
          updated: element.updated,
        },
        content: element.content,
      };
      writeMd(doc);
      delete doc.content;
      index.push(doc);
    });
  }
  writeIndex(index);
}
module.exports.fromBacklog = fromBacklog;

function writeIndex(index) {
  index.sort(function(a, b) {
    if (a.sortKey < b.sortKey) {
      return -1;
    }
    if (a.sortKey > b.sortKey) {
      return 1;
    }
    return 0;
  });
  const content = index.map(i => {
    return `* ${i.attributes.docId} ${i.attributes.title}`;
  }).join("\n");
  writeMd({
    file: `${config.backlog_md_dir}/目次.md`,
    attributes: {
      docId: 'index',
      title: '目次',
      updated: moment().toISOString(),
    },
    content: content,
  });
}

function writeMd(doc) {
  // front-matter
  const fm = yaml.safeDump(doc.attributes);
  // MDを整形する
  const content = formatMd(doc.content);
  // MDを出力する
  const md = `---\n${fm}---\n\n${content}`;
  fs.writeFileSync(doc.file, md);
  return doc;
}

function readMd(file) {
  console.log(file);
  const content = fs.readFileSync(file, 'utf8');
  const fm = frontMatter(content);
  const doc = {
    file: file,
    attributes: fm.attributes,
    content: fm.body,
  };
  if (!doc.attributes.title) {
    throw new Error(`front-matter に title がありません file:${file}`);
  }
  return doc;
}

function formatMd(text, options) {
  const prettierOptions = Object.assign({
    parser: 'markdown',
  }, options);
  return prettier.format(text, prettierOptions);
}

function genarateMdFileName(docId, title) {
  const slug = slugger.slug(`${docId} ${title}`);
  return {
    slug: slug,
    file: `${config.backlog_md_dir}/${slug}.md`,
  };
}

function genarateUrl(docId) {
  return `https://${config.backlog_host}/view/${docId}`;
}

async function fetchPosts(projectId, page) {
  if (config.backlog_post_type == 'issue') {
    page.offset = page.nextOffset;
    const issues = await backlog.getIssues({
      projectId: [projectId],
      sort: 'created',
      order: 'asc',
      offset: page.offset,
      count: page.count,
    });
    // if (page.offset == 0) {
    //   console.log(issues[0]);
    // }
    page.elements = issues.map(issue => {
      return {
        docId: issue.issueKey,
        title: issue.summary,
        content: issue.description,
        updated: issue.updated,
      };
    });
    if (page.size == issues.length) {
      page.nextOffset = page.offset + page.size;
    }
    return page;
  }
  throw new Error(`未実装 backlog_post_type:${config.backlog_post_type}`);
}

async function putPost(projectId, doc) {
  if (config.backlog_post_type == 'issue') {
    let res;
    if (!doc.attributes.docId) {
      res = await backlog.postIssue({
        projectId: projectId,
        summary: doc.attributes.title,
        priorityId: await defaultPriorityId(),
        issueTypeId: await defaultIssueTypeId(projectId),
        description: doc.content,
      });
    } else {
      res = await backlog.patchIssue(doc.attributes.docId, {
        summary: doc.attributes.title,
        description: doc.content,
      });
    }
    return {
      docId: res.issueKey,
      title: res.summary,
      content: res.description,
      updated: res.updated,
    };
  }
  throw new Error(`未実装 backlog_post_type:${config.backlog_post_type}`);
}

let _project;
// 例
// {
//   "id": 78120,
//   "projectKey": "HOGE_PROJECT",
//   "name": "○○プロジェクト",
//   "chartEnabled": true,
//   "subtaskingEnabled": true,
//   "projectLeaderCanEditProjectLeader": true,
//   "useWikiTreeView": true,
//   "textFormattingRule": "markdown",
//   "archived": false,
//   "displayOrder": 0
// }

async function findProject() {
  if (_project) {
    return _project;
  }
  const projects = await backlog.getProjects({});
  for (let i=0; i < projects.length; i++) {
    _project = projects[i];
    if (_project.projectKey == config.backlog_project_key) {
      if (_project.textFormattingRule != 'markdown') {
        throw new Error(`このツールは、textFormattingRule が markdown のプロジェクトでのみ使用できます。 ${_project.name} の textFormattingRule は ${_project.textFormattingRule} です。`);
      }
      return _project;
    }
  }
  throw new Error(`プロジェクトが見つかりません projectKey:${config.backlog_project_key}`);
}

async function defaultPriorityId() {
  const priorities = await backlog.getPriorities();
  if (priorities.length == 0) {
    throw new Error(`優先度がありません projectKey:${config.backlog_project_key}`);
  }
  for (let i=0; i < priorities.length; i++) {
    const priority = priorities[i];
    if (priority.name == '中') {
      config.backlog_priority_id = priority.id;
      return priority.id;
    }
  }
  config.backlog_priority_id = priorities[0].id;
  return config.backlog_priority_id;
}

async function defaultIssueTypeId(projectId) {
  const types = await backlog.getIssueTypes(projectId);
  if (types.length == 0) {
    throw new Error(`種別がありません projectId:${projectId}`);
  }
  for (let i=0; i < types.length; i++) {
    const tp = types[i];
    if (tp.name == 'タスク') {
      config.backlog_issue_type_id = tp.id;
      return tp.id;
    }
  }
  config.backlog_issue_type_id = types[0].id;
  return config.backlog_issue_type_id;
}

function createBacklog(_config) {
  config = _config;
  if (config.backlog_api_key) {
    return new backlogjs.Backlog({
      host: config.backlog_host,
      apiKey: config.backlog_api_key,
    });
  }
  if (config.backlog_access_token) {
    return new backlogjs.Backlog({
      host: config.backlog_host,
      accessToken: config.backlog_access_token,
    });
  }
  throw new Error('APIキーあるいはアクセストークンが不明');
}
