const marked = require('marked');
const prettier = require('prettier');
const fs = require('fs');
const yaml = require('js-yaml');
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

async function fromBacklog(config) {
  backlog = createBacklog(config);
  const projectId = await discoverProjectId();
  let page = new Page();
  const index = [];
  const slugger = new marked.Slugger();
  while (page.hasNext()) {
    page = await readPosts(projectId, page);
    page.elements.forEach(element => {
      const slug = slugger.slug(`${element.docId} ${element.title}`);
      const snippet = {
        file: `${config.backlog_md_dir}/${slug}.md`,
        sortKey: element.title.toUpperCase(),
        attributes: {
          docId: element.docId,
          title: element.title,
          url: `https://${config.backlog_host}/view/${element.docId}`,
        },
      };
      index.push(snippet);
      const doc = Object.create(snippet);
      doc.content = element.content;
      writeMd(doc);
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

function formatMd(text, options) {
  const prettierOptions = Object.assign({
    parser: 'markdown',
  }, options);
  return prettier.format(text, prettierOptions);
}

async function readPosts(projectId, page) {
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
      };
    });
    if (page.size == issues.length) {
      page.nextOffset = page.offset + page.size;
    }
    return page;
  }
  throw new Error(`未実装 backlog_post_type:${config.backlog_post_type}`);
}

async function discoverProjectId() {
  if (config.backlog_project_id != null) {
    return config.backlog_project_id;
  }
  const projects = await backlog.getProjects({});
  for (let i=0; i < projects.length; i++) {
    const project = projects[i];
    console.log({
      backlog_project_key: project.projectKey,
    });
    if (project.projectKey == config.backlog_project_key) {
      config.backlog_project_id = project.id;
      console.log(`${config.backlog_project_key} の projectId は ${config.backlog_project_id} です。次回以降は、 .env に backlog_project_id=${config.backlog_project_id} と指定してください。`);
      return config.backlog_project_id;
    }
  }
  throw new Error(`プロジェクトがありません projectKey:${config.backlog_project_key}`);
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
