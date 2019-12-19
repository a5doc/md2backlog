md2backlog
==========

マークダウンの文書を、 [backlog](https://backlog.com/ja/) の wiki あるいは issue と同期するためのツールです。

※このバージョンは、まだ issue にしか対応していません。もうすぐ wiki にも対応します。

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
backlog_attachment_dir=docs/attachments
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
* **backlog_attachment_dir**
    ローカル側の画像などの添付ファイルの保存先ディレクトリを指定してください。
* **backlog_priority_id**
    issueを投稿するときの priority_id 。
    指定がないときには、"中" で投稿します。
* **backlog_issue_type_id**
    issueを投稿するときの issue_type_id 。
    指定がないときには、"タスク" で投稿します。

## 2. backlogからダウンロードする

1件の記事をダウンロードする場合

```
npx md2backlog -r https://example.backlog.com/view/MD2BACKLOG-1
```

全件の記事をダウンロードする場合

```
npx md2backlog -r
```

.env に設定した backlog_md_dir のディレクトリに、 backlog の記事をダウンロードします。  
ダウンロードした記事は、 front-matter に同期のための情報を記録して、保存されます。

ダウンロードされた記事の例

```
---
docId: MD2BACKLOG-1
title: はじめての課題登録
url: 'https://example.backlog.com/view/MD2BACKLOG-1'
updated: '2019-12-17T10:47:05Z'
---

プロジェクトホームの画面です。
ここに、このプロジェクトに関する課題の動向が日別で、最新の50件表示されています。
まずは「課題を追加」してみましょう。メニューの「課題の追加」をクリックして進みます。

![image][example.jpg]

あなた自身がやらないといけないことや、他のプロジェクトメンバーにお願いしたいことなど、
とにかくやらなければならないことを課題として登録しましょう。
だれがやるか「担当者」を設定しておくと分かりやすいですね。 
課題の追加画面の項目を入力したら「登録する」をクリックします。

[example.jpg]: example.jpg
```

**画像の添付ファイルに関する補足**  
画像の添付ファイルは、backlog上では、ファイルを添付したあと `![image][example.jpg]` とだけ記載します。  
ただ、普通のマークダウンだとこれでは、表示されないので、ダウンロード時に最終行に `[example.jpg]: example.jpg` を加えて、本文と一緒に、添付ファイルもダウンロードします。

## 3. backlogにアップする

backlog にアップする md が新規の記事の場合でも front-matter を記載します。  
ただし、 backlog で採番される docId などをあらかじめ記述することはできないので、 `title` だけを記入してください。

初稿の例）
```
---
title: はじめての課題登録
---

ほげほげ・・・
```

アップロードは、1つずつファイルを指定します。  
アップと同時に、ダウンロードも実行して、 front-matter に同期情報を記録します。  
ファイル名を変えても、 front-matter の内容で追従します。

```
npx md2backlog docs/はじめての課題登録.md
```
