'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BookmarkPlus, Check, ChevronRight, ImagePlus, Pencil, Search, Sparkles, Trash2, X } from 'lucide-react';

type Status = 'stock' | 'analyzed' | 'copied' | 'used';
type Stock = {
  id: string;
  title: string;
  url: string;
  memo: string;
  focus_note: string;
  tags: string[];
  status: Status;
  image_key?: string | null;
  image_url?: string | null;
  created_at: string;
};
type Source = {
  id: string;
  name: string;
  url: string;
  description: string;
  strengths: string[];
  sort_order: number;
};

const STATUS_LABEL: Record<Status, string> = {
  stock: 'STOCK', analyzed: 'ANALYZED', copied: 'COPIED', used: 'USED'
};
const FALLBACK_SOURCES: Source[] = [
  { id: 'sankou', name: 'SANKOU!', url: 'https://sankoudesign.com/', description: '日本のWebサイトを幅広く探しやすい。まず見る場所。', strengths: ['日本語', '業種', 'レイアウト'], sort_order: 1 },
  { id: 'muuuuu', name: 'MUUUUU.ORG', url: 'https://muuuuu.org/', description: '国内サイト中心。タイポグラフィや編集的なWebを探しやすい。', strengths: ['国内', 'タイポ', 'グリッド'], sort_order: 2 },
  { id: 'landbook', name: 'Land-book', url: 'https://land-book.com/', description: 'HeroやFooterなどセクション単位の参考探しに向く。', strengths: ['Hero', 'セクション', 'LP'], sort_order: 3 },
  { id: 'siteinspire', name: 'SiteInspire', url: 'https://www.siteinspire.com/', description: '静かなデザインやグリッド、タイポを探すときに便利。', strengths: ['Minimal', 'Grid', 'Typography'], sort_order: 4 },
  { id: 'lapa', name: 'Lapa Ninja', url: 'https://www.lapa.ninja/', description: 'LP・ランディングページの構成を大量に見比べられる。', strengths: ['LP', '構成', 'CTA'], sort_order: 5 },
  { id: 'awwwards', name: 'Awwwards', url: 'https://www.awwwards.com/websites/', description: '表現の上限を見る場所。動き・3D・実験的UIの刺激に。', strengths: ['Motion', 'Experimental', '3D'], sort_order: 6 }
];

export default function DesignStockApp() {
  const [tab, setTab] = useState<'stock' | 'discover'>('stock');
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [sources, setSources] = useState<Source[]>(FALLBACK_SOURCES);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [openForm, setOpenForm] = useState(false);
  const [prefill, setPrefill] = useState<Partial<Source> | null>(null);
  const [editingStock, setEditingStock] = useState<Stock | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [stocksRes, sourcesRes] = await Promise.allSettled([fetch('/api/stocks'), fetch('/api/sources')]);
    if (stocksRes.status === 'fulfilled' && stocksRes.value.ok) setStocks(await stocksRes.value.json());
    if (sourcesRes.status === 'fulfilled' && sourcesRes.value.ok) setSources(await sourcesRes.value.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stocks.filter((s) => {
      const matchesStatus = filter === 'all' || s.status === filter;
      const haystack = [s.title, s.url, s.memo, s.focus_note, ...s.tags].join(' ').toLowerCase();
      return matchesStatus && (!q || haystack.includes(q));
    });
  }, [stocks, query, filter]);

  function openAdd(prefillSource: Partial<Source> | null = null) {
    setEditingStock(null);
    setPrefill(prefillSource);
    setOpenForm(true);
  }

  function openEdit(stock: Stock) {
    setPrefill(null);
    setEditingStock(stock);
    setOpenForm(true);
  }

  function closeForm() {
    setOpenForm(false);
    setEditingStock(null);
    setPrefill(null);
  }

  function handleSaved(stock: Stock) {
    if (editingStock) {
      setStocks(prev => prev.map(item => item.id === stock.id ? stock : item));
    } else {
      setStocks(prev => [stock, ...prev]);
    }
    closeForm();
    setTab('stock');
  }

  async function changeStatus(stock: Stock) {
    const order: Status[] = ['stock', 'analyzed', 'copied', 'used'];
    const next = order[(order.indexOf(stock.status) + 1) % order.length];
    const res = await fetch(`/api/stocks/${stock.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) });
    if (res.ok) setStocks((prev) => prev.map((x) => x.id === stock.id ? { ...x, status: next } : x));
  }

  async function removeStock(id: string) {
    if (!confirm('このストックを削除しますか？')) return;
    const res = await fetch(`/api/stocks/${id}`, { method: 'DELETE' });
    if (res.ok) setStocks((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PERSONAL DESIGN REFERENCE</p>
          <h1>DESIGN <span>STOCK</span></h1>
        </div>
        <button className="primary" onClick={() => openAdd()}><BookmarkPlus size={18}/> ストックを追加</button>
      </header>

      <section className="hero">
        <div>
          <p className="heroLead">「いいな」で終わらせない。</p>
          <p className="heroText">URLと参考にしたい部分を、理由と一緒にストックする。<br/>見つける → 言語化 → 模写 → 転用まで残すデザイン学習庫。</p>
        </div>
        <div className="stats">
          <div><strong>{stocks.length}</strong><span>STOCKS</span></div>
          <div><strong>{stocks.filter(s => s.status === 'used').length}</strong><span>USED</span></div>
          <div><strong>{new Set(stocks.flatMap(s => s.tags)).size}</strong><span>TAGS</span></div>
        </div>
      </section>

      <nav className="tabs">
        <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}>MY STOCK</button>
        <button className={tab === 'discover' ? 'active' : ''} onClick={() => setTab('discover')}>REFERENCE SITES</button>
      </nav>

      {tab === 'stock' ? (
        <>
          <div className="toolbar">
            <label className="search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="メモ・URL・タグを検索" /></label>
            <div className="filters">
              {(['all','stock','analyzed','copied','used'] as const).map(x => <button key={x} className={filter === x ? 'active' : ''} onClick={() => setFilter(x)}>{x === 'all' ? 'ALL' : STATUS_LABEL[x]}</button>)}
            </div>
          </div>

          {loading ? <p className="empty">読み込み中…</p> : visible.length === 0 ? (
            <div className="emptyState"><Sparkles size={28}/><h2>まだストックがありません</h2><p>参考サイトを見つけたら、URLと「どこが良かったか」を残してみよう。</p><button className="primary" onClick={() => openAdd()}>最初の1件を追加</button></div>
          ) : (
            <div className="masonry">
              {visible.map(stock => <article className="card" key={stock.id}>
                <div className="cardVisual">
                  {stock.image_url ? <Image src={stock.image_url} alt="" fill sizes="(max-width: 720px) 100vw, 33vw" className="cover" /> : <div className="visualPlaceholder"><span>{new URL(stock.url).hostname}</span></div>}
                  <button className="statusPill" onClick={() => changeStatus(stock)}>{STATUS_LABEL[stock.status]} <ChevronRight size={13}/></button>
                </div>
                <div className="cardBody">
                  <div className="cardTitleRow"><h2>{stock.title}</h2><a href={stock.url} target="_blank" rel="noreferrer" aria-label="サイトを開く"><ArrowUpRight size={18}/></a></div>
                  {stock.focus_note && <p className="focus">↳ {stock.focus_note}</p>}
                  {stock.memo && <p className="memo">{stock.memo}</p>}
                  <div className="tagRow">{stock.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>
                  <div className="cardActions">
                    <button className="editButton" onClick={() => openEdit(stock)}><Pencil size={14}/> 編集</button>
                    <button className="delete" onClick={() => removeStock(stock.id)}><Trash2 size={14}/> 削除</button>
                  </div>
                </div>
              </article>)}
            </div>
          )}
        </>
      ) : (
        <section className="sourceGrid">
          {sources.map((source, i) => <article className="sourceCard" key={source.id}>
            <div className="sourceNo">0{i + 1}</div>
            <h2>{source.name}</h2>
            <p>{source.description}</p>
            <div className="tagRow">{source.strengths.map(x => <span key={x}>#{x}</span>)}</div>
            <div className="sourceActions"><a href={source.url} target="_blank" rel="noreferrer">見に行く <ArrowUpRight size={15}/></a><button onClick={() => openAdd(source)}>ここからストック</button></div>
          </article>)}
        </section>
      )}

      {openForm && <StockForm prefill={prefill} editStock={editingStock} onClose={closeForm} onSaved={handleSaved} />}
    </main>
  );
}

function StockForm({ prefill, editStock, onClose, onSaved }: { prefill: Partial<Source> | null; editStock: Stock | null; onClose: () => void; onSaved: (stock: Stock) => void }) {
  const isEditing = Boolean(editStock);
  const [title, setTitle] = useState(editStock?.title ?? prefill?.name ?? '');
  const [url, setUrl] = useState(editStock?.url ?? prefill?.url ?? '');
  const [focusNote, setFocusNote] = useState(editStock?.focus_note ?? '');
  const [memo, setMemo] = useState(editStock?.memo ?? '');
  const [tagText, setTagText] = useState(editStock?.tags.join(', ') ?? prefill?.strengths?.join(', ') ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('');
    try {
      let imageKey: string | null = null;
      let imageUrl: string | null = null;
      if (file) {
        const sign = await fetch('/api/uploads/presign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, contentType: file.type }) });
        if (!sign.ok) throw new Error('画像アップロードの準備に失敗しました');
        const signed = await sign.json();
        const upload = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!upload.ok) throw new Error('R2への画像アップロードに失敗しました');
        imageKey = signed.key; imageUrl = signed.publicUrl;
      }

      const tags = tagText.split(/[,、]/).map(x => x.trim().replace(/^#/, '')).filter(Boolean);
      const payload: Record<string, unknown> = { title, url, focusNote, memo, tags };
      if (file) {
        payload.imageKey = imageKey;
        payload.imageUrl = imageUrl;
      }

      const endpoint = isEditing ? `/api/stocks/${editStock!.id}` : '/api/stocks';
      const method = isEditing ? 'PATCH' : 'POST';
      const res = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(isEditing ? '編集内容の保存に失敗しました' : 'ストックの保存に失敗しました');
      onSaved(await res.json());
    } catch (err) { setError(err instanceof Error ? err.message : '保存に失敗しました'); }
    finally { setSaving(false); }
  }

  return <div className="modalBackdrop" onMouseDown={onClose}><div className="modal" onMouseDown={e => e.stopPropagation()}>
    <div className="modalHead"><div><p className="eyebrow">{isEditing ? 'EDIT REFERENCE' : 'NEW REFERENCE'}</p><h2>{isEditing ? 'ストックを編集' : '参考ポイントを保存'}</h2></div><button className="iconButton" onClick={onClose} aria-label="閉じる"><X/></button></div>
    <form onSubmit={submit}>
      <div className="formGrid"><label>タイトル<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="例：Studio X / Hero" /></label><label>URL<input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." /></label></div>
      <label>参考にしたい部分<input value={focusNote} onChange={e => setFocusNote(e.target.value)} placeholder="例：Heroの見出しと画像の距離感" /></label>
      <label>なぜ良いと思った？<textarea value={memo} onChange={e => setMemo(e.target.value)} placeholder="見出しは大きいが左右の余白が広く、圧迫感がない。" /></label>
      <label>タグ<input value={tagText} onChange={e => setTagText(e.target.value)} placeholder="余白, Hero, Typography" /></label>
      <label className="upload"><input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={e => setFile(e.target.files?.[0] ?? null)} /><ImagePlus size={23}/><span>{file ? file.name : isEditing && editStock?.image_url ? '画像を差し替える（現在の画像はそのまま）' : '参考箇所のスクショを追加'}</span><small>{isEditing && editStock?.image_url && !file ? '選ばなければ現在の画像を維持します' : '画像はR2へ保存'}</small></label>
      {error && <p className="error">{error}</p>}
      <button className="primary save" disabled={saving}>{saving ? '保存中…' : <><Check size={18}/> {isEditing ? '変更を保存' : 'STOCKする'}</>}</button>
    </form>
  </div></div>;
}
