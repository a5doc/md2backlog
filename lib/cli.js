#!/usr/bin/env node

const fs = require('fs');
const argv = require('minimist')(process.argv.slice(2), {
  boolean: [
    'reverse',
    'init',
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
  backlog_project_id: process.env.backlog_project_id || '', // backlog_project_key と backlog_project_id のどちらかは必須
  backlog_post_type: process.env.backlog_post_type || 'issue', // issue or wiki
  backlog_md_dir: process.env.backlog_md_dir || 'docs',
};

if (argv.init) {
  let envtext = "# md2backlog の設定\n";
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

if (config.backlog_project_key == '' && config.backlog_project_id == '') {
  console.error('.env に backlog_project_key あるいは backlog_project_id を設定してください。');
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
  md2backlog.toBacklog(config)
    .then(result => {
      console.log('Done');
    })
    .catch(err => {
      console.error('Error');
      console.error(err);
    });
}
