# Irodori GUI Frontend Logging And Selection Design

## Goal

- 複数選択で再生成を行う際、選択中セルが一目でわかる UI にする。
- フロントエンドで発生した操作・通信・エラーを、バックエンドログを汚さない形で記録できるようにする。
- バックエンドに疎通できない間も、フロントエンド側でログを保持し、復帰後に送信できるようにする。

## Scope

今回の対象は次の 2 点に限定する。

1. 選択モード中セルの視覚強化
2. フロントエンドログのローカル保持とバックエンドへの分離送信

次は対象外とする。

- ログ画面の大規模なレイアウト刷新
- バックエンド既存ジョブログの意味変更
- IndexedDB ベースの高耐久ログ保存
- ブラウザ外の OS ログ収集

## Approach Summary

### 1. 選択中セルの視覚強化

- 既存の `is-selected` 状態を見た目に反映する。
- 選択中セルには、通常状態と区別できる背景色・枠線・角マーカーを与える。
- `focused`、`unplayed`、`played`、`error` など既存状態は維持しつつ、選択状態が埋もれない優先順位に整理する。
- 選択モード中でも、音声再生やリスト追加など既存のセル内操作は引き続き有効にする。

### 2. ハイブリッド分離ログ

- フロントエンドはログ発生時にまずブラウザ内へ保存する。
- 保存先は `localStorage` とし、プロジェクト単位・セッション単位で扱える軽量キューを持つ。
- バックエンド疎通がある時だけ、専用 API へまとめて送る。
- バックエンドでは frontend 用ログを backend 用ログと別系列で保存する。

## Logging Architecture

### Frontend Log Lifecycle

1. UI 操作、通信失敗、予期しない例外などが起きる。
2. フロントエンドは統一スキーマのログエントリを生成する。
3. その場で `localStorage` の未送信キューへ追加する。
4. 送信可能タイミングで、未送信エントリを専用 API へまとめて送る。
5. バックエンドが受理したエントリだけ、未送信キューから削除する。

これにより、バックエンド未接続時にもログが残り、復旧後に送信できる。

### Separation Rules

- backend ログは既存 `AppLogService` の責務を維持する。
- frontend ログは別 API で受理し、別ファイル系列へ保存する。
- ログ閲覧 API は必要に応じて混在取得できるが、各エントリに `source` を必須で持たせる。
- ファイル保存先も `logs/backend/` と `logs/frontend/` に分ける。

この構成により、backend のジョブ・推論・保存処理ログに frontend の UI 雑音が混ざらない。

## Log Schema

### Shared Fields

frontend / backend の両方で次を共通に持つ。

- `id`
- `timestamp`
- `level`
- `source`
- `project_id`
- `job_id`
- `message`
- `context`

### Source Values

- backend ログ: `source = "backend"`
- frontend ログ: `source = "frontend"`

### Frontend-Specific Context Conventions

frontend ログの `context` には必要に応じて次を入れる。

- `session_id`
- `event_type`
- `request_path`
- `request_method`
- `network_state`
- `error_name`
- `selected_cell_count`
- `selection_mode`

`message` は人間が見て意味が通る短文、`event` は機械処理向きの固定文字列とする。

## Frontend Events To Capture

初回対象は絞る。

### Selection / Regeneration

- `selection_mode_entered`
- `selection_mode_canceled`
- `cell_selection_toggled`
- `bulk_regeneration_requested`

### Network / Error

- `api_request_failed`
- `project_log_refresh_failed`
- `unhandled_frontend_error`

必要以上に全 UI をログ化せず、「後から不具合追跡に効くもの」だけに絞る。

## Backend Changes

### Ingest API

- frontend ログ専用の受け口を追加する。
- 一括送信前提で、複数エントリをまとめて受け取れる形にする。
- 受信時は `source=frontend` を強制し、frontend 側の偽装値をそのまま信用しない。

### Storage

- backend のファイル出力は `logs/backend/` へ保存する。
- frontend 受信ログは `logs/frontend/` へ保存する。
- メモリ上の閲覧対象としても扱えるようにし、既存のログ取得画面に表示できるようにする。

## Frontend Changes

### Selection Visuals

- `LineMatrix` のセル見た目を調整する。
- 選択中セルには明確な選択スタイルを付与する。
- 既存ステータス色と衝突しないよう、選択表現は枠線・オーバーレイ・角マーカー中心で構成する。

### Log Queue

- frontend 側に小さなログサービスを追加する。
- 役割は次の通り。
  - セッション ID の生成
  - ログエントリ生成
  - `localStorage` への enqueue / dequeue
  - backend への flush
- flush は API 成功時やログ取得時など、自然な通信タイミングで試行する。

### Error Handling

- API 呼び出し失敗時は、画面表示とは別に frontend ログを積む。
- backend に疎通できない失敗自体も `network_state=offline_or_unreachable` などの文脈付きで残す。
- flush 失敗で UI を壊さない。ログ送信失敗は静かに再試行対象へ戻す。

## Testing Strategy

### Frontend

- 選択中セルに視覚クラスが付くことをテストする。
- 選択モードでセルクリック時に選択状態が見た目へ反映されることを確認する。
- frontend ログサービスについて、enqueue、flush 成功、flush 失敗時の残留をテストする。

### Backend

- frontend ログ ingest API の受理をテストする。
- frontend ログが `logs/frontend/` に保存されることをテストする。
- frontend 由来ログが `source=frontend` で返ることをテストする。
- backend ログファイル系列と混ざらないことをテストする。

## Risks And Mitigations

### localStorage 容量制限

- 初回はキュー長に上限を持たせ、古い frontend ログから間引く。
- ログ対象イベントも必要最小限に絞る。

### 過剰なログ送信

- flush は単発ごとではなく、配列まとめ送りにする。
- 再試行は自然な API 通信時に寄せ、専用ポーリングは入れない。

### UI 状態との競合

- 選択表示はステータスラベルの意味を壊さない表現にする。
- `error` や `generating` の意味が消えないよう、背景よりも境界・マーカーを優先する。

## Success Criteria

- 選択モード中、選択したセルが目視で即判別できる。
- フロントエンド単独の通信失敗や例外が backend 非接続中でもローカルに残る。
- backend 復帰後、frontend ログを専用 API 経由で送信できる。
- `logs/backend/` と `logs/frontend/` が分離され、backend ログが frontend イベントで汚染されない。
