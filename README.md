md2backlog
==========

マークダウンの文書を、 [backlog](https://backlog.com/ja/) の wiki あるいは issue と同期するためのツールです。

## 1. 準備（初回だけ）

### 1.1. npm の準備

```bash
npm init
npm install github:a5doc/md2backlog

```

### 1.2. backlogの接続先情報を設定

.env ファイルに環境変数として設定します。

```bash
npx md2backlog --init
```

.env が次の内容で作成されるので、対象となるプロジェクトの内容で設定します。

```
# ○○プロジェクトの設定
backlog_api_key=yourApiKey
backlog_host=xxx.backlog.jp
backlog_access_token=yourAccessToken
backlog_project_key=yourProjectKey
backlog_post_type=issue
backlog_md_dir=docs
backlog_priority_id=
backlog_issue_type_id=
```

* **backlog_api_key**
    backlogでAPIキーを作成して貼り付けてください。
    backlog_access_tokenとどちらかの設定は必須です。
* **backlog_host**
    プロジェクトのホスト名
* **backlog_access_token**
    OAuthで認証する場合はアクセストークンを貼り付けてください。
* **backlog_project_key**
    プロジェクトのキー名。プロジェクトのホーム画面のURLの以下例の YYYYY 部分です。  
    https://xxx.backlog.com/projects/YYYYY
* **backlog_post_type**
    マークダウンの文書の投稿先を Wiki にするか、あるいは課題（Issue）としても双方向で、put/getできます。  
    wiki / issue のどちらかで指定してください。
* **backlog_md_dir**
    ローカル側のマークダウン文書の保存先ディレクトリを指定してください。
* **backlog_priority_id**
    issueを投稿するときの priority_id 。
    指定がないときには、"中" で投稿します。
* **backlog_issue_type_id**
    issueを投稿するときの issue_type_id 。
    指定がないときには、"タスク" で投稿します。
