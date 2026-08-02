# Kaenma

Cloudflare上で完結する、オープンソースのマーケティングオートメーション基盤です。

Mauticの「Contact・Segment・Form・Content・Score・Automation・計測」という考え方を、TypeScriptとCloudflare Workers向けに再構築しています。Mautic APIやPHPプラグインとの互換性は目的としていません。

> [!IMPORTANT]
> 現在は `v0.1` の開発版です。本番投入前に、送信ドメイン、同意要件、Resend設定、負荷特性、バックアップ手順を環境ごとに検証してください。

## 特徴

- TanStack Startの公開Workerと、Service Binding経由でのみ呼び出すAPI Workerを分離
- D1を業務データとオートメーション状態機械の正本として使用
- R2によるAsset、CSV、受信添付ファイル、イベントアーカイブの保存
- Queuesと1分Cronによる再開可能なオートメーション実行
- Resend Hosted TemplatesによるTransactional・Marketingメール
- React Emailで管理する認証メールテンプレート
- React Flowを使ったビジュアルオートメーションビルダー
- ステージ型パイプライン、商談、営業タスクを管理するDeals CRM
- Contact・Automation・Email・Deals・Siteを横断するReporting
- Better Authのメール認証、Organization、RBAC、任意のTOTP
- Workspace限定APIキー、TypeScript SDK、MCPサーバー
- 対話式セットアップ、`doctor`、`backup`、`update` CLI

## メール送信ポリシー

Kaenmaはメールの用途を型と実行時検証の両方で分離します。

| 用途            | プロバイダー | 使用例                                       |
| --------------- | ------------ | -------------------------------------------- |
| `transactional` | Resend       | メール確認、招待、パスワード再設定、申込確認 |
| `marketing`     | Resend       | Automation、Segment配信、Broadcast           |

送信元アドレスは用途ごとに分けます。配信停止・購読Topic・同意状態はKaenmaを正本とし、配信と開封・クリック・Bounceなどのイベント取得にはResendを使います。

## アーキテクチャ

```mermaid
flowchart LR
    A["管理者・マーケター"] --> C["Client Worker<br>TanStack Start"]
    V["訪問者・フォーム・Tracking"] --> C
    C -->|"Service Binding"| S["Server Worker<br>Hono / oRPC / REST"]
    CR["Cron Scheduler"] --> S
    S --> D["D1<br>業務データ・実行状態"]
    S --> R["R2<br>Asset・CSV・Archive"]
    S --> Q["Queues<br>Automation・Delivery"]
    Q --> S
    S --> RE["Resend Hosted Templates<br>Transactional・Marketing"]
    S --> WH["Outbound Webhook"]
    ER["Cloudflare Email Routing"] --> S
```

長時間のDelayはQueueに保持せず、D1の`automation_jobs.due_at`に保存します。Cronが期限到達Jobをleaseし、Queueへ渡します。Queue consumerは送信直前に同意、抑止、購読Topic、頻度上限、キャンセル状態を再確認します。

## リポジトリ構成

```text
apps/
  client/                公開Worker、TanStack Start/Query、Vite、Tailwind、React Flow
  server/                内部API Worker、Hono、Cron、Queue、Email Routing
packages/
  orpc/                  ドメイン別のoRPC contractとDTO Zod schema(APIの単一の正本)
  channels/              Resend、Webhook adapter
  core/                  Segment、Automation、Consent、Scheduleの純粋ロジック
  create-kaenma/         Setup、doctor、backup、update CLI
  database/              Drizzle schema/client、D1 migration、repository
  content-renderer/      Landing Page等の安全なHTML/Text renderer
  email-templates/       認証メール用React EmailとResend同期スクリプト
  mcp-server/            Kaenma MCP server
  sdk/                   contract型付きTypeScript SDK
```

`apps/server/src`と`packages/database/src`は同じ12ドメインで一致します:
auth / automations / broadcasts / consent / contacts / deals / messaging /
platform / reports / segments / web / workspaces
(+ `apps/server/src`だけが持つserver専用の`runtime`, `public`, `orpc`)。

`packages/orpc/src`はほぼ同じですが、`auth`(Better Authが直接APIを提供するためcontract化していない)、
`broadcasts`(`messaging`contractに統合)、`platform`(`operations`contractに統合)を持たず、
代わりに`assets`、`operations`、`projects`、横断的な`shared`があります。
`companies`はcontacts配下の`company-contract.ts`/`company-schema.ts`として存在し、独立ドメインではありません。

## 必要環境

- Node.js 22.12以上
- pnpm 11
- Cloudflareアカウント
- Workers Paidプランを推奨
- D1、R2、Queues
- Resend（送信ドメイン、送信用API key、Template管理用API key）
- 受信メールを利用する場合はCloudflare Email Routing

## ローカル開発

### 1. 依存関係

```bash
pnpm install
```

### 2. 開発用Secret

```bash
cp .dev.vars.example apps/server/.dev.vars
```

少なくとも次の値を設定します。

```dotenv
BETTER_AUTH_SECRET=32文字以上のランダム値
CREDENTIAL_ENCRYPTION_KEY=32バイト相当のランダム値
TRACKING_SIGNING_SECRET=32文字以上のランダム値
TURNSTILE_SECRET=任意
RESEND_SEND_API_KEY=メール送信に必須
RESEND_MANAGEMENT_API_KEY=Resend Templateの登録・同期に必須
RESEND_WEBHOOK_SECRET=Resend Webhookを利用する場合は必須
```

`CREDENTIAL_ENCRYPTION_KEY`は、Outbound Webhookの署名資格情報をD1へ保存する際のAES-GCMマスターキーです。運用開始後に不用意に変更すると、保存済み資格情報を復号できなくなります。
Resendの資格情報はD1へ保存せず、WorkerのSecret bindingからのみ読み込みます。

認証メールはReact Emailで編集し、Resend Hosted Templatesへ同期します。

```bash
RESEND_MANAGEMENT_API_KEY=re_xxx \
  pnpm --filter @kaenma/email-templates resend:sync
```

このコマンドは`kaenma-password-reset`、`kaenma-email-verification`、
`kaenma-organization-invitation`を作成または更新し、最新バージョンを公開します。

### 3. D1 migration

```bash
pnpm db:migrate:local
```

アプリケーションからのDBアクセスは`@kaenma/database`のDrizzle clientへ統一しています。
テーブル定義は`packages/database/src/<domain>/schema.ts`(ドメイン別)が正本です。
スキーマ変更時は次のコマンドでDrizzle Kitがmigration SQLを生成します。

```bash
pnpm db:generate
```

Wranglerが適用するSQLは`packages/database/migrations`にDrizzle Kitが直接生成します。
手書きmigrationは廃止しました。`v0.1`開発中はmigration履歴を保証せず、スキーマ変更時に
初期migrationを作り直すことがあります。その場合はローカルDBをリセットしてください。

```bash
rm -rf apps/client/.wrangler/state apps/server/.wrangler/state
pnpm db:migrate:local
```

リモートD1を使っている場合は`wrangler d1 delete` / `wrangler d1 create`で作り直し、
`apps/server/wrangler.jsonc`の`database_id`を更新してから`pnpm db:migrate:remote`を実行します。

### 4. 起動

```bash
pnpm dev
```

`pnpm dev`は未適用のローカルD1 migrationを先に適用してから開発サーバーを起動します。

管理画面とAPIは `http://localhost:5173` で利用できます。

開発環境では登録時のメール確認を省略し、アカウント作成後にそのままログインします。本番環境ではメール確認が必須です。

管理画面とAPIをTanStack StartのVite開発サーバーで起動する場合:

```bash
pnpm dev:client
```

### 品質チェック

OxlintはTypeScript 7を利用したtype-aware lint、OxfmtはimportとTailwind CSS v4クラスの整列を有効にしています。

```bash
pnpm format        # コードを整形
pnpm format:check  # 整形差分を検査
pnpm lint          # Oxlintを実行
pnpm lint:fix      # 安全に自動修正できるlintを反映
pnpm check         # format・lint・型・テスト・ビルドを一括検証
```

## Cloudflareへのデプロイ

### Wrangler設定

`apps/client/wrangler.jsonc`は公開Worker `kaenma` と、内部Worker
`kaenma-server`を呼び出す`SERVER` Service Bindingを定義します。

`apps/server/wrangler.jsonc`には以下のBindingsが定義されています。

- `DB`: D1
- `ASSETS_BUCKET`: R2
- `CAMPAIGN_QUEUE`: オートメーション、Broadcast、Import/Export
  (Binding名・Queue名(`kaenma-campaign`)は歴史的名残りで、内容はAutomationにリネーム済みです。稼働中のCloudflare Queueリソースの改名は本リポジトリのリネーム範囲外としています)
- `DELIVERY_QUEUE`: Email、Webhook delivery

ローカル開発ではCloudflare Viteプラグインの`auxiliaryWorkers`により両Workerを
同時に起動します。`kaenma-server`は`workers_dev: false`のため公開URLを持たず、
APIリクエストは`kaenma`からService Bindingで転送されます。

初期状態のD1 `database_id` はプレースホルダーです。実際のD1 IDへ置き換えてください。

### Secret登録

```bash
cd apps/server
pnpm wrangler secret put BETTER_AUTH_SECRET
pnpm wrangler secret put CREDENTIAL_ENCRYPTION_KEY
pnpm wrangler secret put TRACKING_SIGNING_SECRET
pnpm wrangler secret put TURNSTILE_SECRET
pnpm wrangler secret put RESEND_SEND_API_KEY
pnpm wrangler secret put RESEND_MANAGEMENT_API_KEY
pnpm wrangler secret put RESEND_WEBHOOK_SECRET
```

Resend Dashboardには`https://<APP_URL>/api/webhooks/resend`をWebhook URLとして登録し、`email.sent`、`email.delivered`、`email.opened`、`email.clicked`、`email.bounced`、`email.complained`、`email.failed`、`email.suppressed`を購読します。発行されたSigning secretは`RESEND_WEBHOOK_SECRET`として登録してください。Kaenmaは送信時に付与したWorkspace・Delivery tagから対象を特定します。

### Migrationとデプロイ

```bash
pnpm db:migrate:remote
pnpm deploy
```

`pnpm deploy`はService Bindingの参照先である`kaenma-server`を先にデプロイし、
続いてTanStack Startとクライアントアセットを含む`kaenma`をデプロイします。

## 初回セットアップ

1. 管理画面でアカウントを登録する
2. 確認メールからメールアドレスを検証する
3. OrganizationとしてWorkspaceを作成する
4. 必要に応じて購読Topicを作成する
5. WorkerのSecret bindingへResendの送信・Template管理API keyとWebhook signing secretを登録する
6. ContactまたはCSVを取り込む
7. ResendでTemplateを公開し、Kaenmaのメールテンプレート画面から登録する
8. オートメーションを作成・検証・公開する

Better AuthのOrganizationをKaenmaのWorkspaceとして扱います。

| Role     | 主な権限                           |
| -------- | ---------------------------------- |
| Owner    | Workspace全体、メンバー、設定      |
| Admin    | 設定、APIキー、Webhook、運用       |
| Marketer | Contact、Content、Automation、配信 |
| Analyst  | 閲覧、分析、Export                 |
| Viewer   | 閲覧                               |

## オートメーション

オートメーションは次のNodeから構成されます。

- `Source`: Segment参加、Form送信、Contact作成、API/Webhookイベント
- `Action`: Email、Webhook、Tag、Segment、Score、Field更新
- `Condition`: Contact属性、Tag、Scoreなどの条件分岐
- `Decision`: Open、Click、Reply、Page view、Form submission
- `Delay`: 相対時間、絶対日時、曜日・時間帯

公開時に以下を検証します。

- Sourceが一つだけ存在する
- Node IDとEdge IDが重複していない
- Edgeの接続先が存在する
- Node種別に対してBranchが正しい
- 循環がない
- Sourceから到達不能なNodeがない

公開バージョンは不変です。公開後は同じグラフから新しいdraftが作られ、進行中Contactは参加時のバージョンを完走します。

## Broadcast

BroadcastはMarketingメール専用です。

1. 開始時刻をD1へ記録
2. Segmentの受信者を`broadcast_recipients`へ分割スナップショット
3. 同じDelivery Queueへ投入
4. 送信直前に同意と抑止を再評価
5. Resendの公開済みHosted Templateを使って受信者ごとに送信

オートメーションメールとBroadcastは同じDeliveryテーブル、同意判定、イベント正規化を使用します。

## Deals CRM

Dealsはワークスペースごとのパイプラインで商談を管理します。初回利用時に標準ステージを作成し、カンバン上で商談を移動できます。

- 商談金額、完了予定日、担当者、連絡先、会社の関連付け
- 進行中・獲得・失注のライフサイクル
- タスク、電話、メール、ミーティングの期限・担当者・完了管理
- 商談とタスクの変更はWorkspaceとRBACで制限

## Reporting

Reportingは最大366日の期間を指定し、D1に保存された実データをリアルタイムに集計します。

- 連絡先: 総数、アクティブ数、追加・アーカイブ推移、上位リスト・タグ
- オートメーション: 参加・完了、進行中、メール開封・クリック
- メール: 送信・到達・開封・クリック・バウンス・配信停止
- 商談: 作成・獲得・失注、担当者別成績、通貨別フォーキャスト、タスク
- サイト: PV、ユニーク訪問者、特定済み率、フォーム、サイトメッセージ

各詳細レポートはCSVでエクスポートできます。集計APIは`Analyst`以上の権限を必要とし、常にWorkspaceでスコープされます。

## CSV Import / Export

CSV ImportはWorkerで検証後、R2へNDJSONパートとして保存し、Queueで分割処理します。

最低限、次のどちらかの列が必要です。

```text
email
external_id
```

認識する標準列:

```text
email,external_id,first_name,last_name,phone,stage
```

その他の列はCustom Fieldとして保存されます。ExportはCSV数式インジェクションを避けるため、`=`, `+`, `-`, `@`から始まる値をエスケープします。

## API

APIはoRPC contract(`packages/orpc`)を単一の正本として、同じprocedureを2つの入口で提供します。

- `/api/rpc`: 管理画面用のRPCエンドポイント(TanStack Queryとの統合に使用)
- `/api/v1`: SDK・MCP・外部連携用のREST(OpenAPI)エンドポイント。contractの`.route()`メタデータから提供

手書きのRESTハンドラは存在しません。エンドポイントの追加はcontractへのprocedure追加だけで、
両方の入口とOpenAPIドキュメント、SDKの型に同時に反映されます。

レスポンスはcamelCaseのDTOをそのまま返します(`{data: ...}`エンベロープはありません)。
エラーは`{defined, code, status, message, data}`のJSONで、contractに宣言されたコードを返します。

OpenAPI:

```text
GET /api/openapi.json
```

主なEndpoint:

```text
GET    /api/v1/contacts
POST   /api/v1/contacts
GET    /api/v1/contacts/:id/timeline
POST   /api/v1/contacts/import
POST   /api/v1/contacts/export

GET    /api/v1/segments
POST   /api/v1/segments
POST   /api/v1/segments/preview

GET    /api/v1/automations
POST   /api/v1/automations
PUT    /api/v1/automations/:id/draft
POST   /api/v1/automations/:id/publish
POST   /api/v1/automations/:id/enroll

GET    /api/v1/deals
POST   /api/v1/deals
PATCH  /api/v1/deals/:id
POST   /api/v1/deals/:id/move
POST   /api/v1/deals/:id/tasks
PATCH  /api/v1/deals/:dealId/tasks/:taskId

GET    /api/v1/reports/:category

GET    /api/v1/broadcasts
POST   /api/v1/broadcasts
POST   /api/v1/broadcasts/:id/start

GET    /api/v1/email-templates
POST   /api/v1/email-templates
POST   /api/v1/email-templates/:id/sync
POST   /api/v1/email-templates/:id/archive
GET    /api/v1/forms
POST   /api/v1/forms
GET    /api/v1/pages
POST   /api/v1/pages
```

APIではbodyやqueryの`workspace_id`を信用しません。Cookie SessionまたはBearer API KeyからWorkspaceを決定し、D1クエリにも必ず`workspace_id`を含めます。

## TypeScript SDK

SDKはoRPC contractから型付けされ、`/api/v1`(OpenAPI)経由で呼び出します。
サーバーと型がずれることはありません。

```ts
import { createKaenmaClient } from "@kaenma/sdk";

const kaenma = createKaenmaClient({
  baseUrl: "https://ma.example.com",
  apiKey: process.env.KAENMA_API_KEY!,
});

const contacts = await kaenma.contacts.list({
  query: "example.com",
  limit: 25,
});

await kaenma.contacts.create({
  email: "person@example.com",
  firstName: "Kaen",
  customFields: {
    plan: "pro",
  },
});

// contractに宣言されたエラーは型付きで判別できます
import { isDefinedError } from "@kaenma/sdk";
```

APIキーはWorkspace限定で、D1にはSHA-256ハッシュだけを保存します。平文キーは作成時に一度だけ表示されます。

## MCPサーバー

ビルド:

```bash
pnpm --filter @kaenma/mcp-server build
```

環境変数:

```bash
export KAENMA_URL=https://ma.example.com
export KAENMA_API_KEY=kaenma_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxx
node packages/mcp-server/dist/index.js
```

提供する主なTool:

- Contact検索
- Dashboard集計
- オートメーション一覧とdraft取得
- オートメーション enrollmentの準備
- 明示確認後のオートメーション enrollment

実配信につながるオートメーション enrollmentは二段階です。準備Toolが短時間有効な確認Tokenを発行し、確認Toolで `CONFIRM SEND` を明示しない限り実行されません。

## セットアップCLI

ローカルでCLIをビルド:

```bash
pnpm --filter create-kaenma build
```

主なコマンド:

```bash
node packages/create-kaenma/dist/index.js
node packages/create-kaenma/dist/index.js doctor
node packages/create-kaenma/dist/index.js backup
node packages/create-kaenma/dist/index.js update
node packages/create-kaenma/dist/index.js domain add
```

`create-kaenma`はD1、R2、Queues、Secrets、Migration、2つのWorker deploymentを順番に構成します。

開発中のローカルテンプレートを使う場合:

```bash
KAENMA_TEMPLATE_DIR=/path/to/kaenma node packages/create-kaenma/dist/index.js
```

GitHub・npm公開後は`npx create-kaenma`として利用する予定です。`KAENMA_TEMPLATE_REPOSITORY`でclone元も変更できます。

## Email Routing

オートメーションとBroadcastは、署名付きのReply-Toアドレスを生成します。

```text
r+<signed-token>@reply.example.com
```

Email Routing handlerは次を確認します。

- TokenのHMAC署名と有効期限
- Workspace、Delivery、Contactの一致
- 受信メールが5MB以下
- Reply先Deliveryが存在する

本文はD1、添付ファイルはR2へ保存し、`replied` Delivery EventとContact Eventを生成します。

## 同意と配信停止

- Topic別購読
- グローバル配信停止
- Bounce、Complaint、手動抑止
- 24時間単位の頻度上限
- ワンクリック解除
- Preference Center
- 送信直前の再判定

TransactionalメールもBounce、Complaintなどの抑止対象です。Marketingメールはさらにグローバル停止、Topic状態、頻度上限を確認します。

## セキュリティ

- 全業務テーブルと主要Indexに`workspace_id`
- Session/API KeyからWorkspace Contextを決定
- Secure、HttpOnly、SameSite Cookie
- Cookieを使う変更系APIでOriginを検証
- Segment ASTを許可済み演算子からparameterized SQLへ変換
- オートメーション公開時のグラフ検証
- Provider credentialをAES-GCMで暗号化
- WebhookをHMAC、timestamp、event IDで検証
- Tracking、解除、Reply TokenをHMAC署名
- Webhook送信先のHTTPS強制とprivate/link-local IP拒否
- Email HTMLの変数escapeと許可タグ制限
- FormのTurnstile、honeypot、Origin制限、Idempotency Key
- Queue consumerの条件付き状態更新とDelivery冪等キー

脆弱性を発見した場合は、公開Issueへ機密情報を書き込まず、RepositoryのSecurity Advisoryから報告してください。

## テスト

全体:

```bash
pnpm check
```

個別:

```bash
pnpm typecheck
pnpm test
pnpm build
```

WorkerテストはCloudflare Workers Vitest integration上で実行し、実際のD1 migrationを空DBへ適用します。

現在のテスト対象には以下が含まれます。

- Segment ASTのSQL parameter binding
- オートメーションの循環、到達性、Provider制約
- 同意判定
- Job状態遷移とRetry
- Email rendererのescape
- Webhook URLのSSRF対策
- WorkspaceをまたぐContact直接参照の拒否
- Dealのステージ移動、獲得・失注、タスク状態遷移
- Idempotency Keyの重複予約
- Worker healthとD1 migration

## 現在の制約

- `wrangler.jsonc`のD1 ID、送信元ドメイン、Reply domainは環境ごとの設定が必要です。
- Resend Webhookは`/api/webhooks/resend`で受け取り、raw bodyと`svix-*`ヘッダーを使ってResend標準の署名を検証します。
- 大規模なCSVやSegmentは、実データ分布を使った負荷試験が必要です。
- D1は唯一の業務DBですが、古い詳細イベントと大容量ファイルはR2へ退避します。
- SMS、LINE、Push、Mautic API/PHPプラグイン互換、SAML/SCIMは対象外です。
- Cloudflare上の実リソースを必要とするProvider smoke testはCIだけでは完結しません。

## 開発ロードマップ

- 管理画面のLanding Page、Project、Broadcast編集UIの拡充
- Click redirectの完全なリンク書き換え
- Segment差分評価と大規模データ向けQuery最適化
- R2アーカイブの復元・検索Tool
- Provider contract testと負荷試験Fixture
- `create-kaenma`のnpm公開
- デモWorkspaceとオートメーションTemplate

## コントリビューション

IssueやPull Requestを歓迎します。

変更前に次を実行してください。

```bash
pnpm check
```

## ライセンス

[MIT License](./LICENSE)
