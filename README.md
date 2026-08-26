# DESIGN STOCK v0.2

Webデザインの「参考にしたい部分」を、URL・メモ・タグ・スクリーンショットと一緒に保存する個人用リファレンスDBです。

## 構成
- Next.js / Vercel: UI・API
- Neon Postgres: ストック、参考サイト一覧
- Cloudflare R2: スクリーンショット画像
- R2アップロードは10分有効のpresigned PUT URLを発行し、ブラウザから直接R2へ送信

## 環境変数
`.env.example` を `.env.local` にコピーして設定してください。

- `DATABASE_URL`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL`

## 初期REFERENCE SITES
- SANKOU!
- MUUUUU.ORG
- Land-book
- SiteInspire
- Lapa Ninja
- Awwwards

## 次に足せるもの
- URLから自動スクリーンショット
- スクショのトリミング／マーキング
- 1 URLに複数の参考ポイント
- 今日の模写ドリル
- Figmaリンク／制作物のBefore/After
