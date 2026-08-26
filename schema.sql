CREATE TABLE design_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  strengths text[] NOT NULL DEFAULT ARRAY[]::text[],
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE design_stocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  url text NOT NULL,
  memo text NOT NULL DEFAULT '',
  focus_note text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'stock' CHECK (status IN ('stock','analyzed','copied','used')),
  image_key text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX design_stocks_created_at_idx ON design_stocks (created_at DESC);
CREATE INDEX design_stocks_status_idx ON design_stocks (status);

INSERT INTO design_sources (name, url, description, strengths, sort_order) VALUES
('SANKOU!', 'https://sankoudesign.com/', '日本のWebサイトを幅広く探しやすい。まず見る場所。', ARRAY['日本語','業種','レイアウト'], 1),
('MUUUUU.ORG', 'https://muuuuu.org/', '国内サイト中心。タイポグラフィや編集的なWebを探しやすい。', ARRAY['国内','タイポ','グリッド'], 2),
('Land-book', 'https://land-book.com/', 'HeroやFooterなどセクション単位の参考探しに向く。', ARRAY['Hero','セクション','LP'], 3),
('SiteInspire', 'https://www.siteinspire.com/', '静かなデザインやグリッド、タイポを探すときに便利。', ARRAY['Minimal','Grid','Typography'], 4),
('Lapa Ninja', 'https://www.lapa.ninja/', 'LP・ランディングページの構成を大量に見比べられる。', ARRAY['LP','構成','CTA'], 5),
('Awwwards', 'https://www.awwwards.com/websites/', '表現の上限を見る場所。動き・3D・実験的UIの刺激に。', ARRAY['Motion','Experimental','3D'], 6)
ON CONFLICT (url) DO NOTHING;
