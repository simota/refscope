const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/PulseCosmosStage-B-VWat-i.js","assets/index-DZx3Y-UI.js","assets/index-CM9MKIyH.css","assets/fileKind-BA-2ZKJi.js"])))=>i.map(i=>d[i]);
import{r as l,w as je,j as e,L as ae,E as we,_ as Se,D as Ne,x as De,y as Ce,z as Me,A as Te,B as Ee}from"./index-DZx3Y-UI.js";import{c as $,e as ne,a as G,F as He,l as de}from"./fileKind-BA-2ZKJi.js";const Re=18,Ae=-44,We=360*60*1e3,Le=.15,ze=.35,Fe=300*1e3,Pe=38,Ie=22;function ce(t){let o=2166136261;for(let d=0;d<t.length;d++)o^=t.charCodeAt(d),o=o*16777619>>>0;return(o>>>0)/4294967295}function Be(t){return ce(t+"__y")}function X(t,o,d){return t+(o-t)*Math.max(0,Math.min(1,d))}function $e(t,o){const d=Math.max(0,t)+Math.max(0,o);return 210-Math.min(Math.log10(d+1)/3,1)*210}function Ue(t,o){return t.map(d=>{const f=Math.max(0,o-d.ts),h=$e(d.meta.added,d.meta.deleted),x=ce(d.key)*2-1,E=Be(d.key)*2-1,v=Math.min(f/We,1),j=X(ze,1,v),g=x*Pe*j,C=E*Ie*j,H=X(Re,Ae,v),L=X(1,Le,v),R=f<=Fe;return{...d,hue:h,position:[g,C,H],opacity:L,isFresh:R}})}const Ge=l.lazy(()=>Se(()=>import("./PulseCosmosStage-B-VWat-i.js"),__vite__mapDeps([0,1,2,3]))),T=30,U=4e3,Oe=3500,W=30;function oe(t){const o=t.split("/").filter(d=>d.length>0);return o.length<=1?"(root)":o.length===2?o[0]:`${o[0]}/${o[1]}`}function pe(t){if(!t)return"";try{const o=Date.now()-new Date(t).getTime(),d=Math.floor(o/1e3);if(d<5)return"just now";if(d<60)return`${d}s`;const f=Math.floor(d/60);if(f<60)return`${f}m`;const h=Math.floor(f/60);return h<24?`${h}h`:`${Math.floor(h/24)}d`}catch{return""}}function ie(t){switch(t){case"A":return"＋";case"D":return"−";case"R":return"↦";default:return"·"}}function he(t){switch(t){case"A":return"追加";case"D":return"削除";case"M":return"変更";case"R":return"名前変更";case"C":return"コピー";default:return t||"変更"}}const Y="WORKING-TREE",Ke={code:"コード",style:"スタイル",config:"設定",markup:"マークアップ",docs:"ドキュメント",test:"テスト",asset:"アセット",other:"その他"},Xe={code:"TypeScript / JavaScript / Python 等のソースコード",style:"CSS / SCSS / Tailwind 等のスタイル",config:"package.json / vite.config.ts 等の設定",markup:"HTML / Vue / Astro 等のマークアップ",docs:"Markdown / README 等のドキュメント",test:".test.* / .spec.* 等のテスト",asset:"画像 / フォント / バイナリ等のアセット",other:"分類されないファイル"};function Ye(t){return Ke[t]??de(t)}function Je(t){return Xe[t]??""}function le(){return e.jsxs(e.Fragment,{children:[e.jsx("div",{style:{fontWeight:600,marginBottom:6,color:"var(--rs-text-primary)"},children:"Pulse Lens とは"}),e.jsxs("div",{style:{color:"var(--rs-text-secondary)",marginBottom:8},children:["コードベースの",e.jsx("strong",{children:"今の鼓動"}),"を 3D 宇宙で可視化する Lens。 1 カード = 1 ファイル。ログ的な「Activity」ではなく、リポジトリが今動いている感覚を映します。"]}),e.jsx("div",{style:{fontWeight:600,marginBottom:4,color:"var(--rs-text-primary)"},children:"カードの読み方"}),e.jsxs("div",{style:{color:"var(--rs-text-secondary)",marginBottom:8,lineHeight:1.7},children:["・",e.jsx("strong",{children:"1 カード = 1 ファイル"}),e.jsx("br",{}),"・",e.jsx("strong",{children:"位置"})," = ハッシュ由来の固定座標 (X/Y) + 鮮度 (Z: 手前=新)",e.jsx("br",{}),"・",e.jsx("strong",{children:"色 = 変更量"})," (added + deleted の log スケール: 青=軽微 / 緑=小 / 黄=中 / 橙=大 / 赤=巨大)",e.jsx("br",{}),"・",e.jsx("strong",{children:"不透明度 = 鮮度"}),"（古いほど霧化、6 時間で最小）",e.jsx("br",{}),"・",e.jsx("strong",{children:"金枠 + 拡大"})," = 5 分以内に更新",e.jsx("br",{}),"・カードのアクセント帯（左縦線）= ファイル種別 (kind)"]}),e.jsx("div",{style:{fontWeight:600,marginBottom:4,color:"var(--rs-text-primary)"},children:"対象データ"}),e.jsxs("div",{style:{color:"var(--rs-text-secondary)",marginBottom:8},children:[e.jsxs("strong",{children:["直近 ",T," commits + working tree"]})," の変更を 3D カード化。 累計 +N / -N も同じ範囲の合計です。"]}),e.jsx("div",{style:{fontWeight:600,marginBottom:4,color:"var(--rs-text-primary)"},children:"live indicator"}),e.jsxs("div",{style:{color:"var(--rs-text-secondary)",marginBottom:8,lineHeight:1.7},children:["・",e.jsx("span",{style:{color:"var(--rs-git-added)"},children:"緑パルス"}),": SSE 接続中 (リアルタイム取り込み)",e.jsx("br",{}),"・",e.jsx("span",{style:{color:"var(--rs-text-muted)"},children:"グレー"}),": 接続中… または 一時停止",e.jsx("br",{}),"・",e.jsx("span",{style:{color:"var(--rs-warning)"},children:"赤"}),": 切断 (新しい変更は記録されません)"]}),e.jsx("div",{style:{fontWeight:600,marginBottom:4,color:"var(--rs-text-primary)"},children:"操作"}),e.jsxs("div",{style:{color:"var(--rs-text-secondary)"},children:["・",e.jsx("strong",{children:"左ドラッグ"}),"で回転",e.jsx("br",{}),"・",e.jsx("strong",{children:"右ドラッグ"}),"でパン",e.jsx("br",{}),"・",e.jsx("strong",{children:"ホイール"}),"でズーム",e.jsx("br",{}),"・カード",e.jsx("strong",{children:"クリック"})," → ファイル履歴を開く",e.jsx("br",{}),"・カード",e.jsx("strong",{children:"右クリック"})," → コンテキストメニュー",e.jsx("br",{}),'・右側の "Recent changes" リスト → コミット選択']}),e.jsx("div",{style:{fontWeight:600,marginBottom:4,marginTop:8,color:"var(--rs-text-primary)"},children:"凡例 (kind アクセント帯)"}),e.jsx("div",{style:{color:"var(--rs-text-secondary)",fontSize:11},children:"カード左端の縦帯がファイル種別 (kind) を示します。色は下記の凡例と同じです。"})]})}const Ze={"pulse-quiet":{title:"鼓動を待っています",body:"コミットや working tree の変更がまだ観測されていません。リポジトリで何か作業が起きるとカードが現れます。別の Lens で別の観点を確認するか、しばらく待ってみてください。"}};function ss({repoId:t,commits:o,selectedCommitHash:d,onSelectCommit:f,onOpenFileHistory:h,workTree:x,paused:E=!1,eventStatus:v,onChangeLens:j}){const[g,C]=l.useState(()=>new Map),[H,L]=l.useState(()=>new Map),R=l.useRef(new Set),w=l.useRef(new Map),Z=l.useRef(g);l.useEffect(()=>{Z.current=g},[g]);const z=l.useRef(new Set),V=l.useRef(t);l.useEffect(()=>{V.current=t,C(new Map),L(new Map),R.current.clear(),w.current.clear(),z.current.clear()},[t]);const[_,O]=l.useState(null),ue=l.useCallback((s,a)=>{const r=s;O({x:r.clientX,y:r.clientY,path:a})},[]),xe=l.useCallback((s,a)=>{O({x:s.clientX,y:s.clientY,path:a})},[]),q=l.useMemo(()=>typeof window<"u"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches,[]),[F,Q]=l.useState(()=>Date.now());l.useEffect(()=>{const s=window.setInterval(()=>Q(Date.now()),3e4);return()=>window.clearInterval(s)},[]),l.useEffect(()=>{Q(Date.now())},[o,g,x]);const[P,me]=l.useState(()=>Date.now());l.useEffect(()=>{const s=window.setInterval(()=>me(Date.now()),800);return()=>window.clearInterval(s)},[]),l.useEffect(()=>{if(!t)return;const s=o.slice(0,T);for(const a of s)Z.current.has(a.hash)||z.current.has(a.hash)||(z.current.add(a.hash),(async()=>{try{const r=await je(t,a.hash);if(V.current!==t)return;C(i=>{if(i.has(a.hash))return i;const c=new Map(i);return c.set(a.hash,r),c})}catch{}finally{z.current.delete(a.hash)}})())},[o,t]),l.useEffect(()=>{const s=o.slice(0,T),a=Date.now();L(r=>{const i=new Map(r);for(const c of s){const N=g.get(c.hash);if(!N||R.current.has(c.hash))continue;const n=c.shortHash??c.hash.slice(0,7);for(const p of N.files){const u=p.path,y=i.get(u);if(y)i.set(u,{...y,commitCount:y.commitCount+1,totalAdded:y.totalAdded+(p.added??0),totalDeleted:y.totalDeleted+(p.deleted??0),lastSeenHash:c.hash,lastSeenShortHash:n,lastSeenSubject:c.subject,lastSeenTime:c.time,lastStatus:p.status,highlightedUntil:a+U,isWorkingTree:!1});else{const D=u.lastIndexOf("/");i.set(u,{path:u,basename:D===-1?u:u.slice(D+1),parentDir:D===-1?"":u.slice(0,D),topGroup:oe(u),kind:$(u),commitCount:1,totalAdded:p.added??0,totalDeleted:p.deleted??0,lastSeenHash:c.hash,lastSeenShortHash:n,lastSeenSubject:c.subject,lastSeenTime:c.time,lastStatus:p.status,highlightedUntil:a+U,isNewFile:!0,appearedAt:a,isWorkingTree:!1})}}R.current.add(c.hash)}return i})},[o,g]);const A=l.useMemo(()=>{const s=ne(x);if(s.length===0)return w.current.clear(),H;const a=new Map;for(const n of s){const p=a.get(n.path),u=n.section==="untracked";p?a.set(n.path,{added:p.added+n.added,deleted:p.deleted+n.deleted,status:p.status,isUntracked:p.isUntracked||u}):a.set(n.path,{added:n.added,deleted:n.deleted,status:n.status,isUntracked:u})}const r=Date.now(),i=new Set;for(const[n,p]of a)p.isUntracked&&(i.add(n),w.current.has(n)||w.current.set(n,r));for(const n of[...w.current.keys()])i.has(n)||w.current.delete(n);const c=new Map(H),N=(x==null?void 0:x.snapshotAt)??"";for(const[n,p]of a){const u=c.get(n),y=p.isUntracked?w.current.get(n):void 0,D=y!==void 0&&r-y<Oe;if(u)c.set(n,{...u,commitCount:u.commitCount+1,totalAdded:u.totalAdded+p.added,totalDeleted:u.totalDeleted+p.deleted,lastSeenHash:Y,lastSeenShortHash:"WT",lastSeenSubject:"Working tree (uncommitted)",lastSeenTime:N,lastStatus:p.status,isWorkingTree:!0});else{const B=n.lastIndexOf("/");c.set(n,{path:n,basename:B===-1?n:n.slice(B+1),parentDir:B===-1?"":n.slice(0,B),topGroup:oe(n),kind:$(n),commitCount:1,totalAdded:p.added,totalDeleted:p.deleted,lastSeenHash:Y,lastSeenShortHash:"WT",lastSeenSubject:"Working tree (uncommitted)",lastSeenTime:N,lastStatus:p.status,highlightedUntil:D?r+U:0,isNewFile:D,appearedAt:y??0,isWorkingTree:!0})}}return c},[H,x]),ee=l.useMemo(()=>{const s=[],a=F-36e5;for(const r of A.values()){let i=a;if(r.lastSeenTime){const c=new Date(r.lastSeenTime).getTime();isNaN(c)||(i=c)}s.push({key:r.path,groupKey:r.topGroup,ts:i,basename:r.basename,parentDir:r.parentDir,subject:r.lastSeenSubject||"No commit message",meta:{shortHash:r.lastSeenShortHash,added:r.totalAdded,deleted:r.totalDeleted,status:r.lastStatus||"·",kind:r.kind,isWorkingTree:r.isWorkingTree}})}return s},[A,F]),fe=l.useMemo(()=>Ue(ee,F),[ee,F]),S=l.useMemo(()=>{const s=[],a=ne(x);if(a.length>0){for(const r of a)if(s.push({id:`wt::${r.section}::${r.path}`,path:r.path,basename:r.basename,parentDir:r.parentDir,status:r.status,kind:$(r.path),added:r.added,deleted:r.deleted,commitHash:Y,commitShortHash:r.section==="staged"?"STAGED":"UNSTAGED",subject:r.section==="staged"?"Staged":"Unstaged",time:(x==null?void 0:x.snapshotAt)??new Date().toISOString(),isWorkingTree:!0}),s.length>=W)break}if(s.length<W){const r=o.slice(0,T);for(const i of r){const c=g.get(i.hash);if(!c)continue;const N=i.shortHash??i.hash.slice(0,7);for(const n of c.files){const p=n.path.lastIndexOf("/");if(s.push({id:`${i.hash}::${n.path}`,path:n.path,basename:p===-1?n.path:n.path.slice(p+1),parentDir:p===-1?"":n.path.slice(0,p),status:n.status,kind:$(n.path),added:n.added??0,deleted:n.deleted??0,commitHash:i.hash,commitShortHash:N,subject:i.subject,time:i.time,isWorkingTree:!1}),s.length>=W)break}if(s.length>=W)break}}return s.slice(0,W)},[x,o,g]),ge=8e3,se=l.useRef(new Map);l.useEffect(()=>{const s=Date.now(),a=se.current,r=new Set;for(const i of S)r.add(i.id),a.has(i.id)||a.set(i.id,s);for(const i of[...a.keys()])r.has(i)||a.delete(i)},[S]);const te=l.useMemo(()=>{const s=P-ge,a=se.current;return S.filter(r=>(a.get(r.id)??0)>=s).slice(0,5)},[S,P]),[k,I]=l.useState(null),be=l.useCallback(s=>{I(s)},[]),K=l.useCallback(s=>{var r;return s.meta.isWorkingTree||s.meta.shortHash==="WT"?null:((r=o.find(i=>(i.shortHash??i.hash.slice(0,7))===s.meta.shortHash||i.hash.startsWith(s.meta.shortHash)))==null?void 0:r.hash)??null},[o]),ve=l.useCallback(()=>{k&&(h==null||h(k.key),I(null))},[k,h]),_e=l.useCallback(()=>{if(!k)return;const s=K(k);s&&(f(s),I(null))},[k,K,f]),b=l.useMemo(()=>{let s=0,a=0,r=0,i=0;for(const c of A.values())s+=c.totalAdded,a+=c.totalDeleted,P<c.highlightedUntil&&(r+=1),c.isWorkingTree&&(i+=1);return{files:A.size,added:s,deleted:a,hotCount:r,workingTreeCount:i,commits:Math.min(o.length,T)}},[A,o.length,P]);if(o.length===0&&b.workingTreeCount===0)return e.jsxs("div",{style:{display:"flex",flexDirection:"column",height:"100%",background:"var(--rs-bg-canvas)"},children:[e.jsx(ae,{title:"Pulse",oneLiner:"コードベースの今の鼓動 — ファイル変更を 3D 宇宙で可視化",helpContent:e.jsx(le,{})}),e.jsx(we,{reason:"pulse-quiet",messages:Ze,onChangeLens:j,relatedLenses:j?[{id:"stream",label:"File Stream を開く"},{id:"hotspot",label:"Hotspot を開く"},{id:"digest",label:"Digest を開く"}]:void 0})]});const m=E?"paused":v??"connected",re=m==="connected"?"var(--rs-git-added)":m==="error"?"var(--rs-warning)":"var(--rs-text-muted)",ke=m==="connected"?"Connected: ingesting new changes in real time":m==="connecting"?"Connecting…":m==="error"?"Connection lost":"Paused",ye=m==="error"||m==="paused"||m==="connecting";return e.jsxs("div",{className:"rs-pulse-root",children:[e.jsx("style",{children:qe}),e.jsx(ae,{title:"Pulse",oneLiner:"コードベースの今の鼓動 — ファイル変更を 3D 宇宙で可視化",helpContent:e.jsx(le,{})}),e.jsxs("header",{className:"rs-pulse-header",children:[e.jsx("span",{className:"rs-pulse-header__indicator","aria-hidden":"true",children:e.jsx("span",{className:m==="connected"?"rs-pulse-header__dot":"rs-pulse-header__dot rs-pulse-header__dot--static",style:{background:re,boxShadow:`0 0 8px color-mix(in oklab, ${re}, transparent 30%)`}})}),e.jsx("span",{role:"status","aria-live":"polite",className:"rs-pulse-header__live-label","aria-label":ke,children:e.jsx("span",{"aria-hidden":"true",children:m==="connected"?"live":m==="connecting"?"connecting…":m==="error"?"offline":"paused"})}),e.jsx("span",{className:"rs-pulse-header__divider","aria-hidden":"true"}),e.jsxs("span",{className:"rs-pulse-header__stat",children:[e.jsx("strong",{children:b.files.toLocaleString()})," files"]}),e.jsxs("span",{className:"rs-pulse-header__stat",children:[e.jsx("strong",{children:b.commits.toLocaleString()})," commits",e.jsxs("span",{"aria-hidden":"true",style:{color:"var(--rs-text-muted)",marginLeft:4,fontSize:10},children:["/ ",T," max"]})]}),e.jsxs("span",{className:"rs-pulse-header__diff",title:"直近 30 commits + working tree の累計追加 / 削除行数",children:[e.jsxs("span",{"aria-hidden":"true",style:{color:"var(--rs-git-added)"},children:["+",b.added.toLocaleString()]}),e.jsxs("span",{className:"sr-only",children:[b.added.toLocaleString()," lines added"]}),e.jsxs("span",{"aria-hidden":"true",style:{color:"var(--rs-git-deleted)"},children:["−",b.deleted.toLocaleString()]}),e.jsxs("span",{className:"sr-only",children:[b.deleted.toLocaleString()," lines deleted"]})]}),b.hotCount>0&&e.jsxs("span",{className:"rs-pulse-header__hot",title:`直近 ${Math.round(U/1e3)} 秒以内に変更されたファイル数`,children:[b.hotCount," hot"]}),b.workingTreeCount>0&&e.jsxs("span",{className:"rs-pulse-header__wt",title:"working tree の未コミット変更ファイル数",children:[b.workingTreeCount," uncommitted"]}),e.jsx("div",{className:"rs-pulse-header__legend","aria-label":"ファイル種別の凡例",children:["code","style","config","markup","docs","test","asset"].map(s=>e.jsxs("span",{className:"rs-pulse-header__legend-item",title:Je(s),children:[e.jsx("span",{className:"rs-pulse-header__legend-dot",style:{background:G(s)},"aria-hidden":"true"}),e.jsx("span",{children:Ye(s)})]},s))})]}),te.length>0&&e.jsxs("div",{className:"rs-pulse-ticker",role:"status","aria-live":"polite","aria-label":"Recent changes",children:[e.jsx("span",{className:"rs-pulse-ticker__caption","aria-hidden":"true",children:"✦ live"}),te.map(s=>e.jsxs("span",{className:"rs-pulse-ticker__item",children:[e.jsx("span",{className:"rs-pulse-ticker__dot",style:{background:G(s.kind)},"aria-hidden":"true"}),e.jsx("span",{className:"rs-pulse-ticker__status","aria-hidden":"true",children:ie(s.status)}),e.jsx("span",{className:"rs-pulse-ticker__path",title:s.path,children:s.path}),e.jsxs("span",{className:"rs-pulse-ticker__diff",children:[e.jsxs("span",{style:{color:"var(--rs-git-added)"},children:["+",s.added]}),e.jsxs("span",{style:{color:"var(--rs-git-deleted)"},children:["−",s.deleted]})]})]},s.id))]}),ye&&e.jsx("div",{role:"status","aria-live":"polite",className:"rs-pulse-status-banner",style:{padding:"6px 16px",fontSize:11,fontFamily:"var(--rs-sans)",color:m==="error"?"var(--rs-warning)":m==="paused"?"var(--rs-text-secondary)":"var(--rs-text-muted)",background:m==="error"?"color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 12%)":"var(--rs-bg-elevated)",borderBottom:"1px solid var(--rs-border)"},children:m==="error"?"⚠ 接続が途切れています — 新しい変更は記録されていません。":m==="paused"?"Paused — 新しい変更の取り込みを停止しています。":"Connecting — サーバーに接続しています…"}),q&&e.jsx("div",{className:"rs-pulse-reduced-motion-note",style:{padding:"4px 16px",fontSize:10,fontFamily:"var(--rs-sans)",color:"var(--rs-text-muted)",background:"var(--rs-bg-elevated)",borderBottom:"1px solid var(--rs-border)"},children:"Reduced motion: カードアニメーションを抑制しています (Lens は動作中)。"}),e.jsxs("div",{className:"rs-pulse-body",children:[e.jsxs("div",{className:"rs-pulse-stage",role:"region","aria-label":"Codebase pulse 3D cosmos field",style:{background:"radial-gradient(ellipse at 60% 40%, #0a1040 0%, #000814 70%)"},children:[e.jsx(l.Suspense,{fallback:e.jsx("div",{role:"status",className:"rs-pulse-stage__empty",children:"Loading 3D field…"}),children:e.jsx(Ge,{points:fe,selectedCommitHash:d,reducedMotion:q,onPick:be,onContextMenuPoint:xe})}),e.jsx("ul",{role:"status","aria-live":"polite","aria-atomic":"false",style:{position:"absolute",width:1,height:1,padding:0,margin:-1,overflow:"hidden",clip:"rect(0,0,0,0)",whiteSpace:"nowrap",border:0},children:S.slice(0,5).map(s=>{var a;return e.jsxs("li",{children:[s.isWorkingTree?"未コミット":(a=s.commitHash)==null?void 0:a.slice(0,7)," ",s.path," (+",s.added??0," / -",s.deleted??0,")"]},`${s.commitHash??"wt"}:${s.path}`)})})]}),e.jsx("aside",{className:"rs-pulse-sidebar","aria-label":"Recent changes",children:e.jsxs("div",{className:"rs-pulse-recent","aria-label":"Recent changes",children:[e.jsx("div",{className:"rs-pulse-recent__title",children:"Recent changes"}),e.jsx("ul",{className:"rs-pulse-recent__list",children:S.length===0?e.jsx("li",{className:"rs-pulse-recent__empty",children:"No recent changes"}):S.map(s=>{const a=!s.isWorkingTree&&s.commitHash===d;return e.jsx("li",{className:a?"rs-pulse-recent__row rs-pulse-recent__row--selected":"rs-pulse-recent__row",children:e.jsxs("button",{type:"button",className:"rs-pulse-recent__btn",onClick:()=>{s.isWorkingTree||f(s.commitHash)},onContextMenu:r=>{r.preventDefault(),ue(r,s.path)},title:`${s.path}
${s.subject}`,"aria-label":`${he(s.status)}: ${s.path}${s.isWorkingTree?" (working tree)":` — ${s.subject}`}`,"aria-disabled":s.isWorkingTree,disabled:s.isWorkingTree,children:[e.jsx("span",{className:"rs-pulse-recent__dot",style:{background:G(s.kind)},"aria-hidden":"true"}),e.jsx("span",{className:"rs-pulse-recent__status","aria-hidden":"true",children:ie(s.status)}),e.jsxs("span",{className:"rs-pulse-recent__path",children:[s.parentDir&&e.jsxs("span",{className:"rs-pulse-recent__parent",children:[s.parentDir,"/"]}),e.jsx("span",{className:"rs-pulse-recent__base",children:s.basename})]}),e.jsxs("span",{className:"rs-pulse-recent__diff",children:[e.jsxs("span",{style:{color:"var(--rs-git-added)"},children:["+",s.added]}),e.jsxs("span",{style:{color:"var(--rs-git-deleted)"},children:["−",s.deleted]})]}),e.jsx("span",{className:"rs-pulse-recent__time",children:s.isWorkingTree?s.commitShortHash:pe(s.time)})]})},s.id)})})]})})]}),e.jsx(He,{open:_!==null,x:(_==null?void 0:_.x)??0,y:(_==null?void 0:_.y)??0,path:(_==null?void 0:_.path)??null,onClose:()=>O(null),onOpenHistory:s=>{h==null||h(s)}}),e.jsx(Ve,{point:k,onClose:()=>I(null),onOpenHistory:ve,onSelectCommit:_e,canSelectCommit:k?K(k)!==null:!1,canOpenHistory:!!h})]})}function Ve({point:t,onClose:o,onOpenHistory:d,onSelectCommit:f,canSelectCommit:h,canOpenHistory:x}){const E=t!==null,v=t?new Date(t.ts).toISOString():"",j=t?de(t.meta.kind):"",g=t?G(t.meta.kind):"transparent";return e.jsx(Ne,{open:E,onOpenChange:C=>!C&&o(),children:e.jsxs(De,{className:"sm:max-w-2xl",style:{background:"var(--rs-bg-panel)",border:"1px solid var(--rs-border)",color:"var(--rs-text-primary)",fontFamily:"var(--rs-sans)"},children:[e.jsxs(Ce,{children:[e.jsxs(Me,{style:{display:"flex",alignItems:"center",gap:10,fontSize:15,color:"var(--rs-text-primary)",fontFamily:"var(--rs-mono)"},children:[e.jsx("span",{"aria-hidden":"true",style:{width:10,height:10,borderRadius:2,background:g,flexShrink:0}}),e.jsx("span",{style:{wordBreak:"break-all"},children:(t==null?void 0:t.basename)??""}),(t==null?void 0:t.isFresh)&&e.jsx("span",{style:{fontSize:10,fontFamily:"var(--rs-sans)",fontWeight:700,padding:"2px 6px",borderRadius:999,color:"var(--rs-warning)",background:"color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 18%)",border:"1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 45%)",letterSpacing:.5},children:"✦ NEW"})]}),e.jsx(Te,{style:{fontFamily:"var(--rs-mono)",color:"var(--rs-text-secondary)",fontSize:11,wordBreak:"break-all"},children:(t==null?void 0:t.parentDir)||"(root)"})]}),t&&e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:12},children:[e.jsx("div",{style:{fontSize:13,lineHeight:1.5,color:"var(--rs-text-primary)",padding:"10px 12px",background:"var(--rs-bg-elevated)",border:"1px solid var(--rs-border)",borderRadius:"var(--rs-radius-sm)"},children:t.subject}),e.jsxs("dl",{style:{margin:0,display:"grid",gridTemplateColumns:"auto 1fr",rowGap:6,columnGap:12,fontSize:12},children:[e.jsxs(M,{label:"状態",children:[he(t.meta.status)," ",e.jsxs("span",{style:{color:"var(--rs-text-muted)"},children:["(",t.meta.status,")"]})]}),e.jsx(M,{label:"種別",children:e.jsx("span",{style:{color:"var(--rs-text-secondary)"},children:j})}),e.jsxs(M,{label:"差分",children:[e.jsxs("span",{style:{fontFamily:"var(--rs-mono)",color:"var(--rs-git-added)",marginRight:8},children:["+",t.meta.added]}),e.jsxs("span",{style:{fontFamily:"var(--rs-mono)",color:"var(--rs-git-deleted)"},children:["−",t.meta.deleted]})]}),e.jsxs(M,{label:"コミット",children:[e.jsx("span",{style:{fontFamily:"var(--rs-mono)"},children:t.meta.shortHash}),t.meta.isWorkingTree&&e.jsx("span",{style:{marginLeft:6,color:"var(--rs-warning)",fontSize:11},children:"(working tree)"})]}),e.jsx(M,{label:"時刻",children:e.jsxs("span",{style:{fontFamily:"var(--rs-mono)",color:"var(--rs-text-secondary)"},title:v,children:[pe(v),e.jsx("span",{style:{color:"var(--rs-text-muted)",marginLeft:6,fontSize:11},children:v?v.replace("T"," ").slice(0,19):""})]})}),e.jsx(M,{label:"パス",children:e.jsx("span",{style:{fontFamily:"var(--rs-mono)",color:"var(--rs-text-secondary)",wordBreak:"break-all"},children:t.key})})]})]}),e.jsxs(Ee,{style:{marginTop:8,display:"flex",gap:6,justifyContent:"flex-end"},children:[e.jsx(J,{onClick:o,variant:"ghost",children:"閉じる"}),e.jsx(J,{onClick:f,disabled:!h,variant:"secondary",title:h?"このコミットを Timeline で選択":"working tree は Timeline 選択できません",children:"コミットを表示"}),e.jsx(J,{onClick:d,disabled:!x,variant:"primary",children:"ファイル履歴を開く"})]})]})})}function M({label:t,children:o}){return e.jsxs(e.Fragment,{children:[e.jsx("dt",{style:{color:"var(--rs-text-muted)",fontSize:11,letterSpacing:.3,whiteSpace:"nowrap"},children:t}),e.jsx("dd",{style:{margin:0,color:"var(--rs-text-primary)"},children:o})]})}function J({children:t,onClick:o,disabled:d,title:f,variant:h}){const x={primary:{background:"color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 28%)",borderColor:"color-mix(in oklab, var(--rs-border), var(--rs-accent) 55%)",color:"var(--rs-text-primary)"},secondary:{background:"var(--rs-bg-elevated)",borderColor:"var(--rs-border)",color:"var(--rs-text-primary)"},ghost:{background:"transparent",borderColor:"transparent",color:"var(--rs-text-secondary)"}};return e.jsx("button",{type:"button",onClick:o,disabled:d,title:f,style:{...x[h],borderStyle:"solid",borderWidth:1,borderRadius:"var(--rs-radius-sm)",padding:"6px 12px",fontSize:12,fontFamily:"var(--rs-sans)",fontWeight:500,cursor:d?"not-allowed":"pointer",opacity:d?.5:1,transition:"background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out"},children:t})}const qe=`
.rs-pulse-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background:
    radial-gradient(ellipse at top left,  color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 6%), transparent 55%),
    radial-gradient(ellipse at bottom right, color-mix(in oklab, var(--rs-bg-canvas), #8b5cf6 5%), transparent 60%),
    var(--rs-bg-canvas);
  overflow: hidden;
  font-family: var(--rs-sans, system-ui);
  color: var(--rs-text-primary);
}

.rs-pulse-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--rs-border);
  background: color-mix(in oklab, var(--rs-bg-panel), transparent 10%);
  backdrop-filter: blur(6px);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.rs-pulse-header__indicator {
  position: relative;
  width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.rs-pulse-header__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--rs-git-added);
  box-shadow: 0 0 8px color-mix(in oklab, var(--rs-git-added), transparent 30%);
  animation: rs-pulse-dot 1.6s ease-out infinite;
}
@keyframes rs-pulse-dot {
  0%, 100% { transform: scale(1);   opacity: 1; }
  50%      { transform: scale(1.3); opacity: 0.55; }
}
.rs-pulse-header__title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rs-text-primary);
}
.rs-pulse-header__divider {
  width: 1px;
  height: 14px;
  background: var(--rs-border);
  opacity: 0.6;
}
.rs-pulse-header__stat {
  font-size: 12px;
  color: var(--rs-text-secondary);
}
.rs-pulse-header__stat strong {
  font-family: var(--rs-mono, ui-monospace, monospace);
  color: var(--rs-text-primary);
  font-weight: 700;
  margin-right: 3px;
}
.rs-pulse-header__diff {
  display: inline-flex;
  gap: 6px;
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 12px;
  font-weight: 600;
}
.rs-pulse-header__hot {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 2px 7px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(120deg, #f97316, #ec4899);
  box-shadow: 0 0 8px color-mix(in oklab, #ec4899, transparent 60%);
  text-transform: uppercase;
}
.rs-pulse-header__wt {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 2px 7px;
  border-radius: 999px;
  color: #f59e0b;
  background: color-mix(in oklab, var(--rs-bg-canvas), #f59e0b 12%);
  border: 1px solid color-mix(in oklab, var(--rs-border), #f59e0b 50%);
  text-transform: uppercase;
}
.rs-pulse-header__legend {
  margin-left: auto;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--rs-text-secondary);
}
.rs-pulse-header__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rs-pulse-header__legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.rs-pulse-body {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.rs-pulse-stage {
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
  min-width: 0;
}
.rs-pulse-stage__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--rs-text-secondary);
  font-size: 13px;
}

.rs-pulse-sidebar {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid var(--rs-border);
  background: color-mix(in oklab, var(--rs-bg-panel), transparent 10%);
  overflow-y: auto;
  overflow-x: hidden;
}

.rs-pulse-recent {
  padding: 8px 16px 10px;
}
.rs-pulse-recent__title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rs-text-secondary);
  margin-bottom: 4px;
}
.rs-pulse-recent__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rs-pulse-recent__row {
  display: flex;
  width: 100%;
}
.rs-pulse-recent__row--selected .rs-pulse-recent__btn {
  background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 18%);
  border-color: color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%);
}
.rs-pulse-recent__btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--rs-text-primary);
  transition: background 120ms ease-out, border-color 120ms ease-out;
  text-align: left;
  min-width: 0;
}
.rs-pulse-recent__btn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 6%);
  border-color: color-mix(in oklab, var(--rs-border), transparent 30%);
}
.rs-pulse-recent__btn:disabled {
  cursor: default;
  opacity: 0.85;
}
.rs-pulse-recent__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rs-pulse-recent__status {
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 11px;
  width: 12px;
  flex-shrink: 0;
  text-align: center;
  color: var(--rs-text-secondary);
}
.rs-pulse-recent__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-pulse-recent__parent {
  color: var(--rs-text-secondary);
  opacity: 0.8;
}
.rs-pulse-recent__base {
  font-weight: 600;
  color: var(--rs-text-primary);
}
.rs-pulse-recent__diff {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
}
.rs-pulse-recent__time {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--rs-text-muted, var(--rs-text-secondary));
  min-width: 32px;
  text-align: right;
}
.rs-pulse-recent__empty {
  font-family: var(--rs-sans, system-ui);
  font-size: 12px;
  color: var(--rs-text-secondary);
  padding: 6px 8px;
}

/* Activity Ticker — リアルタイム俯瞰用の新着ピル */
.rs-pulse-ticker {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 16px;
  background: color-mix(in oklab, var(--rs-bg-panel), transparent 22%);
  border-bottom: 1px solid var(--rs-border);
  overflow-x: hidden;
  min-height: 30px;
  font-family: var(--rs-mono);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.rs-pulse-ticker__caption {
  font-family: var(--rs-sans);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rs-warning);
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 18%);
  border: 1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 45%);
  flex-shrink: 0;
  animation: rs-pulse-ticker-caption 2.4s ease-in-out infinite;
}
@keyframes rs-pulse-ticker-caption {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.7; transform: scale(0.96); }
}
.rs-pulse-ticker__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 14%);
  border: 1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 35%);
  color: var(--rs-text-primary);
  white-space: nowrap;
  flex-shrink: 0;
  animation: rs-pulse-ticker-in 360ms cubic-bezier(.2,.7,.3,1);
  box-shadow: 0 0 12px color-mix(in oklab, var(--rs-accent), transparent 65%);
}
@keyframes rs-pulse-ticker-in {
  from { opacity: 0; transform: translateX(28px) scale(0.85); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}
.rs-pulse-ticker__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rs-pulse-ticker__status {
  color: var(--rs-text-secondary);
  font-size: 10px;
  width: 10px;
  text-align: center;
}
.rs-pulse-ticker__path {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--rs-text-primary);
}
.rs-pulse-ticker__diff {
  display: inline-flex;
  gap: 4px;
  font-weight: 600;
  font-size: 10px;
}

@media (prefers-reduced-motion: reduce) {
  .rs-pulse-header__dot {
    animation: none !important;
  }
  .rs-pulse-ticker__item,
  .rs-pulse-ticker__caption {
    animation: none !important;
  }
}
`;export{ss as PulseLens};
