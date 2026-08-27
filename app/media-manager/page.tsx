'use client';

import { useEffect, useMemo, useState } from 'react';

type MediaItem = {
  key: string;
  size: number;
  updatedAt: string | null;
  url: string | null;
};

const fmtSize = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

const kind = (key: string) => {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) return 'video';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext)) return 'image';
  return 'other';
};

export default function MediaManagerPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [bucket, setBucket] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'video' | 'image' | 'other'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const all: MediaItem[] = [];
      let cursor: string | null = null;
      do {
        const url = new URL('/api/media', window.location.origin);
        if (cursor) url.searchParams.set('cursor', cursor);
        const res = await fetch(url.toString(), { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '読み込みに失敗しました');
        setBucket(data.bucket || '');
        all.push(...(data.items || []));
        cursor = data.nextCursor || null;
      } while (cursor);
      setItems(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((x) => !q || x.key.toLowerCase().includes(q))
      .filter((x) => filter === 'all' || kind(x.key) === filter)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [items, query, filter]);

  const totalSize = items.reduce((sum, x) => sum + x.size, 0);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function removeSelected() {
    if (!selected.size) return;
    const ok = window.confirm(`${selected.size}件をR2から完全に削除します。\nこの操作は元に戻せません。`);
    if (!ok) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch('/api/media', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '削除に失敗しました');
      const deleted = new Set<string>(data.deleted || []);
      setItems((prev) => prev.filter((x) => !deleted.has(x.key)));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main style={{minHeight:'100vh',background:'#f5f5f3',color:'#171717',fontFamily:'Arial, sans-serif',padding:'28px'}}>
      <div style={{maxWidth:1480,margin:'0 auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:20,alignItems:'flex-end',marginBottom:20,flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:12,letterSpacing:1.4,color:'#737373',marginBottom:6}}>HARF-WAY / STORAGE</div>
            <h1 style={{fontSize:34,margin:0}}>R2 Media Manager</h1>
            <div style={{marginTop:7,color:'#666',fontSize:14}}>Bucket: {bucket || '—'}</div>
          </div>
          <div style={{display:'flex',gap:10}}>
            <button onClick={load} style={btn(false)}>再読み込み</button>
            <button disabled={!selected.size || deleting} onClick={removeSelected} style={btn(true, !selected.size || deleting)}>
              {deleting ? '削除中…' : `選択を削除 (${selected.size})`}
            </button>
          </div>
        </div>

        <section style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:12,marginBottom:16}}>
          <Stat label="OBJECTS" value={`${items.length} 件`} />
          <Stat label="TOTAL SIZE" value={fmtSize(totalSize)} />
          <Stat label="SELECTED" value={`${selected.size} 件`} />
        </section>

        <section style={{background:'#fff',border:'1px solid #ddd',borderRadius:16,padding:14,marginBottom:16,display:'flex',gap:10,flexWrap:'wrap'}}>
          <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="ファイル名・フォルダ名で検索" style={{flex:'1 1 320px',padding:'12px 14px',border:'1px solid #ccc',borderRadius:10,fontSize:15}} />
          <select value={filter} onChange={(e)=>setFilter(e.target.value as typeof filter)} style={{padding:'12px 14px',border:'1px solid #ccc',borderRadius:10,fontSize:15,background:'#fff'}}>
            <option value="all">すべて</option><option value="video">動画</option><option value="image">画像</option><option value="other">その他</option>
          </select>
        </section>

        {error && <div style={{background:'#fff0f0',border:'1px solid #e6b6b6',padding:14,borderRadius:12,marginBottom:16}}>{error}</div>}
        {loading ? <div style={{padding:40,textAlign:'center'}}>R2を読み込み中…</div> : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(245px,1fr))',gap:14}}>
            {visible.map((item) => {
              const type = kind(item.key);
              const checked = selected.has(item.key);
              return <article key={item.key} style={{background:'#fff',border:checked?'2px solid #111':'1px solid #ddd',borderRadius:16,overflow:'hidden',boxShadow:'0 2px 8px rgba(0,0,0,.03)'}}>
                <div style={{aspectRatio:'16/10',background:'#ededeb',display:'grid',placeItems:'center',overflow:'hidden',position:'relative'}}>
                  <input type="checkbox" checked={checked} onChange={()=>toggle(item.key)} style={{position:'absolute',top:12,left:12,width:20,height:20,zIndex:2}} />
                  {type === 'video' && item.url ? <video src={item.url} controls preload="metadata" style={{width:'100%',height:'100%',objectFit:'contain'}} /> : null}
                  {type === 'image' && item.url ? <img src={item.url} alt="" loading="lazy" style={{width:'100%',height:'100%',objectFit:'contain'}} /> : null}
                  {type === 'other' ? <div style={{fontSize:13,color:'#777'}}>PREVIEWなし</div> : null}
                </div>
                <div style={{padding:13}}>
                  <div title={item.key} style={{fontSize:14,fontWeight:700,wordBreak:'break-all',lineHeight:1.45,minHeight:40}}>{item.key}</div>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8,marginTop:12,fontSize:12,color:'#777'}}><span>{type.toUpperCase()}</span><span>{fmtSize(item.size)}</span></div>
                  <div style={{fontSize:12,color:'#999',marginTop:6}}>{item.updatedAt ? new Date(item.updatedAt).toLocaleString('ja-JP') : '—'}</div>
                </div>
              </article>;
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({label,value}:{label:string;value:string}) {
  return <div style={{background:'#fff',border:'1px solid #ddd',borderRadius:14,padding:'15px 17px'}}><div style={{fontSize:11,letterSpacing:1.1,color:'#888'}}>{label}</div><div style={{fontSize:24,fontWeight:700,marginTop:5}}>{value}</div></div>;
}

function btn(danger=false, disabled=false): React.CSSProperties {
  return {border:'1px solid '+(danger?'#c9a3a3':'#bbb'),background:danger?'#7f1d1d':'#fff',color:danger?'#fff':'#111',borderRadius:10,padding:'11px 15px',fontWeight:700,cursor:disabled?'not-allowed':'pointer',opacity:disabled?.45:1};
}
