const marked = require('marked');
const prettier = require('prettier');
const fs = require('fs-extra')
const yaml = require('js-yaml');
const frontMatter = require('front-matter');
const path = require('path');
const glob = require('glob');

module.exports = {
  write: write,
  read: read,
  format: format,
  convToBacklogMd: convToBacklogMd,
  convToNormalMd: convToNormalMd,
  genarateMdFileName: genarateMdFileName,
};

function write(doc) {
  // front-matter
  const fm = yaml.safeDump(doc.fm.attributes);
  // MDを整形する
  const content = format(doc.fm.body);
  // MDを出力する
  const md = `---\n${fm}---\n\n${content}`;
  try {
    fs.statSync(path.dirname(doc.file));
  } catch (err) {
    fs.mkdirpSync(path.dirname(doc.file));
  }
  fs.writeFileSync(doc.file, md);
  return doc;
}

function read(file) {
  const content = fs.readFileSync(file, 'utf8');
  const doc = {
    file: file,
    fm: frontMatter(content),
  };
  doc.fm.body = format(doc.fm.body);
  if (!doc.fm.attributes.title) {
    throw new Error(`front-matter に title がありません file:${file}`);
  }
  return doc;
}

function format(text, options) {
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

/**
 * 普通の md を backlog の md 形式に変換する
 * 
 * backlogのissueでは、イメージなどを表示されるのは、
 * imageReference と definition が使われていていて、
 * definition の方は、issue本文には書かない
 * 
 * 例 issue 本文
 * ```
 * ほげほげ
 * ![image][attachment1.jpg]
 * ふがふが
 * ```
 * 
 * 上記例だと、 ![xxx][yyy] は、yyy部分が () じゃなくて、[] なので
 * 普通のmdの場合には、 yyy が文末に定義されてないと表示されない。
 * 
 * 普通のmdの場合
 * ```
 * ほげほげ
 * ![image][attachment1.jpg]
 * ふがふが
 * 
 * [attachment1.jpg]: attachment1.jpg
 * ```
 */
async function convToBacklogMd(doc) {
  let content = doc.fm.body;
  const processor = unified()
    .use(
      remarkParse,
      {
        footnotes: true,
        gfm: true
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

  const ast = await processor.parse(content);
  const links = [];
  const images = [];
  const definitionItems = [];
  walkAst(ast, 1, null, function(node, depth, parentNode) {
    // console.log({
    //   depth: depth,
    //   node: node,
    // });
    if (node.type == 'link') {
      if (!node.url.match(/^http/)) {
        links.push(node);
      }
    } else if (node.type == 'image') {
      if (!node.url.match(/^http/)) {
        images.push(node);
      }
    } else if (node.type == 'definition') {
      definitionItems.push({
        parentNode: parentNode,
        node: node,
      });
    }
  });
  // mdの本体にある ![xxx][yyy] の yyy の definition をリストアップして、
  // 且つ、本文テキストからは削除する
  const attachmentNodes = [];
  definitionItems.forEach(definitionItem => {
    const definition = definitionItem.node;
    if (definition.url.match(/^http/)) {
      return;
    }
    try {
      // 添付ファイルがローカル上に存在する場合、それを、添付ファイルとして
      // アップするために、 attachmentNodes にリストアップする
      // 且つ、本文からは削除するので、ASTツリーからは削除する
      // （削除した状態の parentNode.children に作りなおす）
      const file = path.join(path.dirname(doc.file), definition.url);
      const stats = fs.statSync(file);
      attachmentNodes.push({
        definition: definition,
        size: stats.size,
      });
      definitionItem.parentNode.children = definitionItem.parentNode.children.filter(child => {
        return child.position.start != definition.position.start;
      });
    } catch (err) {
      // ファイルがない
      return;
    }
  });
  // mdの本体にある ![xxx](zzz) の zzz がローカルに存在する場合は、
  // それを添付ファイルとして、 ![xxx][zzz] と [zzz]: zzz の imageReference と
  // definition に変換して登録する
  //
  // { type: 'image',
  //   title: null,
  //   url: 'hoge.jpg',
  //   alt: 'image',
  // }
  // { type: 'imageReference',
  //   identifier: 'hoge.jpg',
  //   label: 'hoge.jpg',
  //   referenceType: 'full',
  //   alt: 'image',
  // }
  // { type: 'definition',
  //   identifier: 'hoge.jpg',
  //   label: 'hoge.jpg',
  //   title: null,
  //   url: 'hoge.jpg',
  // }
  images.forEach(node => {
    try {
      const file = path.join(path.dirname(doc.file), node.url);
      const stats = fs.statSync(file);
      const definition = {
        type: 'definition',
        identifier: node.url,
        label: node.url,
        title: null,
        url: node.url,
      };
      attachmentNodes.push({
        definition: definition,
        size: stats.size,
      });
      node.type = 'imageReference';
      node.identifier = node.url;
      node.label = node.url;
      node.referenceType = 'full';
      delete node.title;
    } catch (err) {
      // ファイルがない
      return;
    }
  });
  // { type: 'link',
  //   title: null,
  //   url: 'hoge.md',
  // }
  links.forEach(node => {
    const original = node.url;
    try {
      const file = path.resolve(path.dirname(doc.file), original);
      const linkMd = read(file);
      node.url = linkMd.fm.attributes.docId;
    } catch (err) {
      // ファイルがない
      const lineNo = parseInt(node.position.start.line) + Object.keys(doc.fm.attributes).length + 3;
      throw new Error(`${doc.file} (${lineNo}): link先の文書がありません "${original}"`);
    }
  });
  // astからテキストに変換
  content = await processor.stringify(ast);
  return {
    content: content,
    attachmentNodes: attachmentNodes,
  };
}

async function convToNormalMd(content, attachments, mdFile, mdDir, attachmentsDir, projectKey, hostName) {
  if (attachments.length == 0) {
    return content;
  }
  // backlogからgetしたときには、添付ファイルが、 definition になってないので、
  // 文末に追加する
  let relativePath = path.relative(path.dirname(mdFile), attachmentsDir);
  relativePath = relativePath.replace(/\\/g, '/');
  content += "\n\n";
  const lines = attachments.map(a => {
    return `[${a.name}]: ${relativePath}/${a.name}`;
  })
  content += lines.join('\n');

  const processor = unified()
    .use(
      remarkParse,
      {
        footnotes: true,
        gfm: true
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

  const ast = await processor.parse(content);
  const links = [];
  walkAst(ast, 1, null, function(node, depth, parentNode) {
    // console.log({
    //   depth: depth,
    //   node: node,
    // });
    if (node.type == 'link') {
      links.push(node);
    }
  });
  // mdの本体にある ![xxx](zzz) の zzz が issue の key だったら
  // ローカルのmdファイルへのパスに置き換える
  // { type: 'link',
  //   title: null,
  //   url: '/view/MD2BACKLOG-1',
  // }
  links.forEach(node => {
    const re = new RegExp(`^(https://${hostName})?(/view/)?(${projectKey}-[0-9]+)$`);
    const matches = re.exec(node.url);
    if (!matches) {
      return;
    }
    const docId = matches[3];
    const title = node.children[0].value;
    const file = genarateMdFileName(docId, title, mdDir);
    node.url = path.relative(path.dirname(mdFile), file).replace(/\\/g, '/');
  });
  // astからテキストに変換
  content = await processor.stringify(ast);
  return content;
}

function walkAst(node, depth, parentNode, callback) {
  callback(node, depth, parentNode);
  if (!node.children) {
    return;
  }
  node.children.forEach(child => {
    walkAst(child, depth+1, node, callback);
  });
}

let _localMdIndex;

/**
 * ローカルのmdを読み込んでインデックスを作成する。
 * 省メモリのために、本文を除いた map にする。
 */
function localMdIndex(mdDir) {
  if (_localMdIndex) {
    return _localMdIndex;
  }
  const files = glob.sync(`${mdDir}/**/*.md`);
  const index = {};
  files.forEach(file => {
    const doc = read(file);
    delete doc.fm.body;
    index[doc.fm.attributes.docId] = doc;
  });
  _localMdIndex = index;
  return index;
}

/**
 * md のファイル名を作成する。
 * docId でローカルの md を探して、存在する場合は、同じファイルパスにする。
 * 新規の場合は、 `config.backlog_md_dir` に作成する。
 * @param {*} docId 
 * @param {*} title 
 * @param {*} defaultMdDir 
 */
function genarateMdFileName(docId, title, defaultMdDir) {
  const localMds = localMdIndex(defaultMdDir);
  if (localMds[docId]) {
    return localMds[docId].file;
  }
  const slugger = new marked.Slugger();
  const slug = slugger.slug(`${docId} ${title}`);
  return `${defaultMdDir}/${slug}.md`;
}
