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

module.exports = {
  putBacklog: putBacklog,
  fromBacklog: fromBacklog,
};

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
  const postElement = await putPost(project.id, doc);
  if (postElement == null) {
    console.log('差分がないため、更新されませんでした。');
    return;
  }
  const mergedAttributes = Object.assign(doc.fm.attributes, {
    docId: postElement.docId,
    title: postElement.title,
    url: genarateUrl(postElement.docId),
    updated: postElement.updated,
  });
  writeMd({
    file: mdFile,
    fm: {
      attributes: mergedAttributes,
      body: postElement.content,
    }
  });
}

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
        fm: {
          attributes: {
            docId: element.docId,
            title: element.title,
            url: genarateUrl(element.docId),
            updated: element.updated,
          },
          body: element.content,
        }
      };
      writeMd(doc);
      delete doc.fm.body;
      index.push(doc);
    });
  }
  writeIndex(index);
}

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
    return `* ${i.fm.attributes.docId} ${i.fm.attributes.title}`;
  }).join("\n");
  writeMd({
    file: `${config.backlog_md_dir}/目次.md`,
    fm: {
      attributes: {
        docId: 'index',
        title: '目次',
        updated: moment().toISOString(),
      },
      body: content,
    }
  });
}

function writeMd(doc) {
  // front-matter
  const fm = yaml.safeDump(doc.fm.attributes);
  // MDを整形する
  const content = formatMd(doc.fm.body);
  // MDを出力する
  const md = `---\n${fm}---\n\n${content}`;
  fs.writeFileSync(doc.file, md);
  return doc;
}

function readMd(file) {
  const content = fs.readFileSync(file, 'utf8');
  const doc = {
    file: file,
    fm: frontMatter(content),
  };
  doc.fm.body = formatMd(doc.fm.body);
  if (!doc.fm.attributes.title) {
    throw new Error(`front-matter に title がありません file:${file}`);
  }
  normalizeMd(doc);
  //console.dir(doc);
  return doc;
}

function formatMd(text, options) {
  const prettierOptions = Object.assign({
    parser: 'markdown',
  }, options);
  return prettier.format(text, prettierOptions);
}

//const inspect = require('unist-util-inspect');
const unified = require('unified');
const remarkParse = require("remark-parse");
const remarkMath = require("remark-math");
const stringify = require('remark-stringify');
const definitions = require('mdast-util-definitions');

async function normalizeMd(doc) {
  const processor = unified()
    .use(
      remarkParse,
      {
        footnotes: true,
        commonmark: true
      }
    )
    .use(remarkMath)
    //.use(retextForBacklog)
    .use(stringify, {
      bullet: '*',
      fences: true,
      listItemIndent: '1',
      incrementListMarker: true,
    });

  const ast = await processor.parse(doc.fm.body);
  const definition = definitions(ast);
  const attachments = definition('image');
  console.log(attachments);

  /*
  console.dir({
    ast1: ast1,
    ast2: ast2,
  });
  */
  const res = await processor.stringify(ast);
  console.log(res);
}

function retextForBacklog(destination, options) {
  var fn = destination && destination.run ? bridge : mutate
  return fn(destination, options)
}

// Mutate mode.
// Further transformers run on the nlcst tree.
function mutate(parser, options) {
  return transformer
  function transformer(node, file) {
    return mdast2nlcst(node, file, parser, options)
  }
}

function bridge(destination, options) {
  return transformer
  function transformer(node, file, next) {
    var Parser = destination.freeze().Parser
    var tree = mdast2nlcst(node, file, Parser, options)
    destination.run(tree, file, done)
    function done(err) {
      next(err)
    }
  }
}


function backlogImage() {
  const proto = this.Parser.prototype;
  const methods = proto.inlineMethods;
  methods.splice(methods.indexOf("link"), 0, "backlogImage");
  proto.inlineTokenizers.backlogImage = tokenizer;

  const re = RegExp('(!\\[.*?\\])\\[(.*?)\\]');

  function tokenizer(eat, value) {
    const matches = re.exec(value);
    if (matches) {
      const now = eat.now(); // テキスト中の現在の位置を取得
      now.column += matches.index;
      now.offset += matches.index;
      const subvalue = value.slice(0, matches.index + matches[0].length);
      const replaced = subvalue.slice(0, matches.index) + matches[1] + '(' + matches[2] + ')';
      return eat(subvalue)({
        type: 'backlogImageNode',
        value: replaced, 
      });
      return eat(matches[0])({
        type: "backlogImageNode",
        value: matches[0]
      });
    }
  }
  tokenizer.locator = function(value, fromIndex) {
    const matches = re.exec(value.substr(fromIndex));
    if (matches) {
      return matches.index + fromIndex;
    }
    return -1;
  };
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
    // 課題を一覧で取得
    const issues = await backlog.getIssues({
      projectId: [projectId],
      sort: 'created',
      order: 'asc',
      offset: page.offset,
      count: page.count,
    });
    // issueのレスポンスから文書elementに変換する（issueとwikiの文書を共通化するため）
    page.elements = issues.map(issue => {
      return convIssueToPostElement(issue);
    });
    // 添付ファイルを取得
    for (let i=0; i < page.elements.length; i++) {
      const element = page.elements[i];
      if (element.attachments.length == 0) {
        continue;
      }
      element.content += "\n\n";
      for (let j=0; j < element.attachments.length; j++) {
        const attachment = element.attachments[j];
        const data = await backlog.getIssueAttachment(element.docId, attachment.id);
        // console.log(data);
        let file;
        if (data.filename && data.filename != '') {
          attachment.filename = decodeURIComponent(data.filename);
          file = `${config.backlog_md_dir}/${data.filename}`;
        } else {
          attachment.filename = attachment.name;
          file = `${config.backlog_md_dir}/${attachment.name}`;
        }
        fs.writeFileSync(file, data.body, 'binary');
        element.content += `[${attachment.name}]: ${attachment.filename}\n`;
      }
    }
    // ページネーションの更新
    if (page.size == issues.length) {
      page.nextOffset = page.offset + page.size;
    }
    return page;
  }
  throw new Error(`未実装 backlog_post_type:${config.backlog_post_type}`);
}

function convIssueToPostElement(issue) {
  const attachments = issue.attachments.map(attachment => {
    return {
      id: attachment.id,
      name: attachment.name,
      filename: null,
    };
  });
  return {
    docId: issue.issueKey,
    title: issue.summary,
    content: issue.description,
    updated: issue.updated,
    attachments: attachments,
  };
}

async function putPost(projectId, doc) {
  if (config.backlog_post_type == 'issue') {
    let issue;
    if (!doc.fm.attributes.docId) {
      issue = await backlog.postIssue({
        projectId: projectId,
        summary: doc.fm.attributes.title,
        priorityId: await defaultPriorityId(),
        issueTypeId: await defaultIssueTypeId(projectId),
        description: doc.fm.body,
      });
    } else {
      currIssue = await backlog.getIssue(doc.fm.attributes.docId);
      if (currIssue.description == doc.fm.body && currIssue.summary == doc.fm.attributes.title) {
        return null;
      }
      issue = await backlog.patchIssue(doc.fm.attributes.docId, {
        summary: doc.fm.attributes.title,
        description: doc.fm.body,
      });
  }
    return convIssueToPostElement(issue);
  }
  throw new Error(`未実装 backlog_post_type:${config.backlog_post_type}`);
}

let _project;

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

// getProjects のレスポンス例
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

// getIssues のレスポンス例
// { id: 2588018,
//   projectId: 54567,
//   issueKey: 'MD2BACKLOG-1',
//   keyId: 1,
//   issueType:
//    { id: 249602,
//      projectId: 54567,
//      name: 'タスク',
//      color: '#7ea800',
//      displayOrder: 0 },
//   summary: 'はじめての課題登録',
//   description: 'ほげほげ・・・',
//   resolution: null,
//   priority: { id: 3, name: '中' },
//   status:
//    { id: 1,
//      projectId: 54567,
//      name: '未対応',
//      color: '#ed8077',
//      displayOrder: 1000 },
//   assignee: null,
//   category: [],
//   versions: [],
//   milestone: [],
//   startDate: null,
//   dueDate: null,
//   estimatedHours: null,
//   actualHours: null,
//   parentIssueId: null,
//   createdUser:
//    { id: 147474,
//      userId: 'xxxxxx',
//      name: 'ほげユーザー',
//      roleType: 1,
//      lang: 'ja',
//      mailAddress: 'hoge@example.tokyo',
//      nulabAccount:
//       { nulabId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
//         name: 'ほげユーザー',
//         uniqueId: 'hoge-id' },
//      keyword: 'ほげユーザー HOGEYUSA-' },
//   created: '2019-12-14T01:10:06Z',
//   updatedUser:
//    { id: 147474,
//      userId: 'xxxxxx',
//      name: 'ほげユーザー',
//      roleType: 1,
//      lang: 'ja',
//      mailAddress: 'hoge@example.tokyo',
//      nulabAccount:
//       { nulabId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
//         name: 'ほげユーザー',
//         uniqueId: 'hoge-id' },
//      keyword: 'ほげユーザー HOGEYUSA-' },
//   updated: '2019-12-15T21:03:51Z',
//   customFields: [],
//   attachments:
//    [ { id: 1456920,
//        name: 'Picture.jpg',
//        size: 420310,
//        createdUser: [Object],
//        created: '2019-12-14T01:10:41Z' } ],
//   sharedFiles: [],
//   stars: [] }
