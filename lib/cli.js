#!/usr/bin/env node

const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2), {
  boolean: [
    'reverse',
    'init',
    'dryrun',
  ],
  alias: {
    r: 'reverse',
  },
});

require('dotenv').config();
const config = {
  backlog_api_key: process.env.backlog_api_key || "yourApiKey",
  backlog_host: process.env.backlog_host || "xxx.backlog.jp",
  backlog_access_token: process.env.backlog_access_token || "yourAccessToken",
  backlog_project_key: process.env.backlog_project_key || "yourProjectKey",
  backlog_post_type: process.env.backlog_post_type || 'issue', // issue or wiki
  backlog_md_dir: process.env.backlog_md_dir || 'docs',
  backlog_attachment_dir: process.env.backlog_attachment_dir || 'docs/attachments',
  backlog_priority_id: process.env.backlog_priority_id || '',
  backlog_issue_type_id: process.env.backlog_issue_type_id || '',
};

if (argv.init) {
  let envtext = "# ○○プロジェクトの設定\n";
  Object.keys(config).forEach(p => {
    envtext += `${p}=${config[p]}\n`;
  });
  fs.writeFileSync('.env', envtext);
  console.log('.env を作成しました。内容を編集してください。');
  process.exit(0);
}

if (config.backlog_api_key == 'yourApiKey') {
  throw new Error('.env に接続情報を設定してください');
}

if (config.backlog_project_key == '') {
  console.error('.env に backlog_project_key の設定がありません。');
  process.exit(1);
}

const md2backlog = require('./md2backlog');

if (argv.reverse) {
  md2backlog.fromBacklog(config)
    .then(result => {
      console.log('Done');
    })
    .catch(err => {
      console.error('Error');
      console.error(err);
    });
} else {
  const mdFile = argv._[0];
  if (argv.dryrun) {
    config.dryrun = true;
  }
  md2backlog.putBacklog(config, mdFile)
    .then(result => {
      console.log('Done');
    })
    .catch(err => {
      console.error('Error');
      console.error(err);
    });
}
