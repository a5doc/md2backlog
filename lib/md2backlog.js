const marked = require('marked');
const slugger = new marked.Slugger();
const fs = require('fs-extra')
const moment = require('moment');
const path = require('path');
const md = require('./md');

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

/**
 * ローカルのMDをbacklogに投稿する
 * 
 * @param {*} config コンフィグ
 * @param {*} mdFile mdのファイルパス
 */
async function putBacklog(config, mdFile) {
  backlog = createBacklog(config);
  const doc = md.read(mdFile);
  const project = await findProject();
  const postElement = await putPost(project.id, doc);
  if (postElement == null) {
    // 差分がないため更新なし or dryrun
    return;
  }
  const mergedAttributes = Object.assign(doc.fm.attributes, {
    docId: postElement.docId,
    title: postElement.title,
    url: genarateUrl(postElement.docId),
    updated: postElement.updated,
  });
  md.write({
    file: mdFile,
    fm: {
      attributes: mergedAttributes,
      body: postElement.content,
    }
  });
}

/**
 * backlog上の記事をローカルに取得する
 * 
 * @param {*} config コンフィグ
 */
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
      md.write(doc);
      delete doc.fm.body;
      index.push(doc);
    });
  }
  writeIndex(index);
}

/**
 * 目次ページを作成する
 * 
 * @param {*} index 
 */
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
  md.write({
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

/**
 * backlogから記事を取得する
 * 
 * @param {*} projectId 
 * @param {*} page 
 */
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
      for (let j=0; j < element.attachments.length; j++) {
        const attachment = element.attachments[j];
        const data = await backlog.getIssueAttachment(element.docId, attachment.id);
        // console.log(data);
        if (data.filename && data.filename != '') {
          attachment.filename = decodeURIComponent(data.filename);
        } else {
          attachment.filename = attachment.name;
        }
        const file = `${config.backlog_attachment_dir}/${attachment.filename}`;
        try {
          fs.statSync(path.dirname(file));
        } catch (err) {
          fs.mkdirpSync(path.dirname(file));
        }
        const dest = fs.createWriteStream(file);
        data.body.pipe(dest);
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

/**
 * issueのレスポンスをPostElementに変換する。
 * PostElementはissueとwikiの記事を共通化することを目的にしている。
 * 
 * @param {*} issue 
 */
function convIssueToPostElement(issue) {
  const attachments = issue.attachments.map(attachment => {
    return {
      id: attachment.id,
      name: attachment.name,
      filename: null,
    };
  });
  const doc = {
    docId: issue.issueKey,
    title: issue.summary,
    content: issue.description,
    updated: issue.updated,
    attachments: attachments,
  };
  doc.content = md.convToNormalMd(doc.content, doc.attachments, config.backlog_md_dir, config.backlog_attachment_dir);
  return doc;
}

/**
 * 記事を投稿する
 * 
 * @param {*} projectId 
 * @param {*} doc 
 */
async function putPost(projectId, doc) {
  if (config.backlog_post_type == 'issue') {
    const backlogMd = await md.convToBacklogMd(doc);
    let deleteAttachments = [];
    let uploadAstNodes = [];
    let attachments = [];
    if (doc.fm.attributes.docId) {
      // docId がある場合は、更新になるので、
      // 既存の記事を取得して、差分があるかチェックする
      do {
        currIssue = await backlog.getIssue(doc.fm.attributes.docId);
        deleteAttachments = currIssue.attachments;
        uploadAstNodes = backlogMd.attachmentNodes;
        if (currIssue.attachments.length != backlogMd.attachmentNodes.length) {
          break;
        }
        // 添付ファイルが一致するかチェックする
        const notFound = backlogMd.attachmentNodes.filter(astNode => {
          const found = currIssue.attachments.filter(attachment => {
            // definitionの定義の中で、attachment.nameと一致するのは
            // definition.urlで、definition.identifierは小文字かされていて一致しない
            if (astNode.definition.url != attachment.name) {
              return false;
            }
            if (astNode.size != attachment.size) {
              return false;
            }
            return true;
          });
          return found.length == 0;
        });
        if (notFound.length > 0) {
          break;
        }
        // 添付ファイルが一致！
        deleteAttachments = [];
        uploadAstNodes = [];
        attachments = currIssue.attachments;
        // 添付ファイルと本文が一致すれば、差分無しとする
        if (currIssue.description == backlogMd.content && currIssue.summary == doc.fm.attributes.title) {
          console.log('差分がないため、更新されませんでした。');
          return null;
        }
      } while (false);
    }
    if (config.dryrun) {
      console.log('=== dryrun ===\n本文 --->');
      console.log(backlogMd.content);
      console.log('<---');
      console.dir({
        '削除する添付ファイル': deleteAttachments,
        '登録する添付ファイル': uploadAstNodes,
        '更新のない添付ファイル': attachments,
      });
      return null;
    }

    // 添付ファイルに差分がある場合、全削除して全登録する
    if (deleteAttachments.length > 0) {
      await deleteIssueAttachments(doc.fm.attributes.docId, deleteAttachments);
    }
    let updateAttachmentIds = attachments.map(a => a.id);
    if (uploadAstNodes.length > 0) {
      updateAttachmentIds = await uploadAstAttachmentNodes(uploadAstNodes);
    }

    let issue;
    if (!doc.fm.attributes.docId) {
      issue = await backlog.postIssue({
        projectId: projectId,
        summary: doc.fm.attributes.title,
        priorityId: await defaultPriorityId(),
        issueTypeId: await defaultIssueTypeId(projectId),
        description: backlogMd.content,
        attachmentId: updateAttachmentIds,
      });
    } else {
      issue = await backlog.patchIssue(doc.fm.attributes.docId, {
        summary: doc.fm.attributes.title,
        description: backlogMd.content,
        attachmentId: updateAttachmentIds,
      });
    }
    return convIssueToPostElement(issue);
  }
  throw new Error(`未実装 backlog_post_type:${config.backlog_post_type}`);
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

async function putAttachment(file) {
  const form = new FormData();
  form.append('file', fs.createReadStream(file));
  form.append('filename', path.basename(file));
  return await backlog.postSpaceAttachment(form);
}

async function uploadAstAttachmentNodes(astNodes) {
  const uploaded = [];
  for (let i=0; i < astNodes.length; i++) {
    const astNode = astNodes[i];
    const file = `${config.backlog_md_dir}/${astNode.definition.url}`;
    const res = await putAttachment(file);
    uploaded.push(res.id);
  }
  return uploaded;
}

async function deleteIssueAttachments(docId, attachments) {
  for (let i=0; i < attachments.length; i++) {
    const attachment = attachments[i];
    await backlog.deleteIssueAttachment(docId, attachment.id);
  }
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
