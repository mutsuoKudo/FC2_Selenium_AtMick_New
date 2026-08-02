# 別PCへの移行メモ

この文書は、このプロジェクトを別PCの VS Code + Codex で継続するための手順をまとめたものです。
実際のパスワードなどの秘密情報は、この文書やGitへ登録しないでください。

## 1. 現在の構成

- Gitリモート: `https://github.com/mutsuoKudo/FC2_Selenium_AtMick_New.git`
- 共通開発ブランチ: `develop`
- 現在のPCで使用しているブランチ: `feature/OrdinaryUse_Tt`
- DBサーバー: `192.168.0.198:3306`
- データベース: `seleniumdb`
- DBユーザー: `appuser`
- DBパスワード: 各PCの `.env` にのみ設定する
- 主な技術: Node.js、TypeScript、Selenium WebDriver、Chrome、MySQL

## 2. 別PCでリポジトリを取得する

別PCでは `develop` を基点にします。

```bash
git clone https://github.com/mutsuoKudo/FC2_Selenium_AtMick_New.git
cd FC2_Selenium_AtMick_New
git switch develop
git pull --ff-only origin develop
```

VS Codeで開きます。

```bash
code .
```

Codexには、最初にこの `PC_MIGRATION_MEMO.md` とリポジトリの状態を確認するよう依頼してください。Codexの会話履歴そのものはGitでは移行されないため、この文書を引き継ぎ情報として使用します。

## 3. 必要なソフトウェア

別PCに次のソフトウェアを用意します。

- Git
- VS Code
- Codexを利用するためのVS Code環境
- Node.jsのLTS版とnpm
- Google Chromeまたは互換性のあるChromium
- 必要に応じてMySQL Workbench

依存パッケージをロックファイルどおりにインストールします。

```bash
npm ci
```

TypeScriptを確認します。

```bash
npm run build
```

## 4. `.env` の作成

`.env` はGit管理外です。cloneしても別PCには作成されないため、`.env.example` から作ります。

Bashの場合:

```bash
cp .env.example .env
```

PowerShellの場合:

```powershell
Copy-Item .env.example .env
```

作成した `.env` を次の形式で設定します。

```dotenv
MYSQL_HOST=192.168.0.198
MYSQL_PORT=3306
MYSQL_DATABASE=seleniumdb
MYSQL_USER=appuser
MYSQL_PASSWORD=実際のパスワードを各PCで入力
```

注意事項:

- `.env` をcommitまたはpushしない
- `.env.example` の `MYSQL_PASSWORD` は空欄のままにする
- パスワードをチャット、スクリーンショット、ログへ載せない
- パスワードの受け渡しには安全なパスワード管理手段を使用する
- Ubuntuでは `chmod 600 .env` を実行する
- `.env` はプロジェクトのルートに置き、原則としてプロジェクトルートからnpmコマンドを実行する

`.env` がGitから除外されていることは次のコマンドで確認できます。

```bash
git check-ignore -v .env
```

## 5. DB接続の確認

DBの内容を変更せず、接続と `SELECT 1` だけを確認するBashコマンドです。認証情報は画面へ表示しません。

```bash
node -r dotenv/config -e 'const mysql=require("mysql2/promise");(async()=>{let c;try{c=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,connectTimeout:10000});await c.query("SELECT 1");console.log("DB connection: OK")}catch(e){console.error("DB connection: FAILED",e.code||e.message);process.exitCode=1}finally{if(c)await c.end()}})()'
```

成功時は次のように表示されます。

```text
DB connection: OK
```

接続できない場合は、以下を確認します。

- 別PCから `192.168.0.198` へ到達できるか
- TCPポート `3306` がファイアウォールで許可されているか
- MySQL側で `appuser` に別PCの接続元IPからの権限があるか
- `.env` のホスト、ユーザー、パスワードが正しいか

## 6. 通常の実行コマンド

＠ミック用:

```bash
npm run start:at-mick
```

鉄腕原子用:

```bash
npm run start:tetsuwan-genshi
```

`active_flg=2` を対象にする場合:

```bash
npm run start:inactive-interval:at-mick
npm run start:inactive-interval:tetsuwan-genshi
```

ログは主に次の場所へ出力されます。

```text
log/application/
log/system/
log/access/
```

ログファイルはGitへ登録しません。

## 7. FC2ブログ発見処理

最初はDBを変更しないドライランを実行します。

```bash
npm run discover:fc2
```

内容を確認後、発見したブログを `selenium_url_fc2` へINSERTする場合だけ `--apply` を付けます。

```bash
npm run discover:fc2 -- --apply
```

最大10候補に制限する例:

```bash
npm run discover:fc2 -- --apply --limit=10
```

`--apply` はDBを書き換えるため、対象と件数を確認してから使用してください。

その他の補助コマンド:

```bash
npm run pickup:mayu
npm run normalize:post-date
```

## 8. MySQL Workbench

MySQL 8.4にはMySQL Workbenchから接続できます。接続設定は次のとおりです。

```text
Hostname: 192.168.0.198
Port: 3306
Username: appuser
Default Schema: seleniumdb
```

MySQL WorkbenchはMySQL 8.4へ接続できますが、一部の管理機能が完全には対応しない可能性があります。通常のSQL実行やテーブル参照には利用できます。

## 9. ブランチ運用

### 現在のPC

現在のPCでは次のブランチを使用します。

```bash
git switch feature/OrdinaryUse_Tt
git pull --ff-only origin feature/OrdinaryUse_Tt
```

### 別PC

別PCでは最初に `develop` を最新化し、変更内容ごとにfeatureブランチを作る方法を推奨します。

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/変更内容を表す名前
git push -u origin feature/変更内容を表す名前
```

`.env` はブランチを切り替えても各PCに残ります。ただし、`git clean -fdx` はignoredファイルを含めて削除するため実行しないでください。

PC専用ブランチを長期間使用する場合は、`develop` との差が大きくならないよう定期的に最新内容を取り込みます。

```bash
git fetch origin
git switch feature/OrdinaryUse_Tt
git rebase origin/develop
```

共有済みブランチをrebaseするとpush時に履歴の扱いが難しくなる場合があります。不明な場合は、実行前にCodexへ現在の `git status` と履歴を確認させてください。

## 10. pushが拒否された場合

次のエラーは、GitHub側にローカル未取得のコミットがある場合に発生します。

```text
develop -> develop (fetch first)
```

`develop` では次の順で安全に取り込みます。

```bash
git fetch origin
git log --oneline --left-right develop...origin/develop
git pull --rebase origin develop
git push origin develop
```

コンフリクトが出た場合は、解決せずに強制pushしないでください。`--force` や `--force-with-lease` は、リモートの変更を失う可能性があるため、状況を確認せず使用しません。

SourceTreeでローカルブランチ名と `origin/同名ブランチ` が同じコミットに表示されていれば同期済みです。push件数表示だけが残る場合は、フェッチ、画面更新、SourceTree再起動を試します。

## 11. Ubuntu Serverで動かす場合

Node.js、Chrome/Chromium、MySQLへのネットワーク接続が必要です。GUIのないUbuntu Serverでは、現在コメントアウトされているChromeのヘッドレス設定を有効にする必要があります。

```ts
options.addArguments("--headless=new");
```

また、ログディレクトリへ実行ユーザーが書き込めるようにし、systemdやcronでは作業ディレクトリをプロジェクトルートへ設定します。

## 12. セキュリティ上の注意

- DBパスワードは `.env` だけに保存する
- FC2ログイン情報は現時点でソースに直接記載されているため、将来的に環境変数へ移すことを推奨する
- ソースやGit履歴に登録された可能性のある実パスワードは変更する
- Chromeを外部サイトの巡回に使用するため、OS、Node.js、Chrome、依存パッケージを定期的に更新する
- `npm install` 時点で依存パッケージの脆弱性警告があるため、更新前に影響と互換性を確認する

## 13. 移行完了チェックリスト

- [ ] GitHubからcloneできた
- [ ] `develop` を取得した
- [ ] `npm ci` が成功した
- [ ] `.env.example` から `.env` を作成した
- [ ] `.env` に実際のDBパスワードを安全に設定した
- [ ] `.env` が `git check-ignore` で除外されている
- [ ] DBの `SELECT 1` 接続テストが成功した
- [ ] Chromeがインストールされている
- [ ] `npm run build` が成功した
- [ ] 対象プロファイルでSelenium処理を実行できた
- [ ] ログ出力先と書き込み権限を確認した
- [ ] 別PC用のfeatureブランチを必要に応じて作成した
