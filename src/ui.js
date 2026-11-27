"use strict";
/* Engine lives in <script id="engine" type="text/plain"> so the same source can also be
   compiled into a Web Worker (keeps the UI responsive while the AI thinks). */
(function(){const s=document.createElement('script');s.textContent=document.getElementById('engine').textContent;document.head.appendChild(s)})();

const $=id=>document.getElementById(id);
function idle(fn){window.requestIdleCallback?requestIdleCallback(fn,{timeout:1500}):setTimeout(fn,60)}
let toastT=0;
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2300)}
function confirmDlg(msg){return new Promise(res=>{$('dlgText').textContent=msg;$('dlg').classList.remove('hidden');const done=v=>{$('dlg').classList.add('hidden');res(v)};$('dlgYes').onclick=()=>done(true);$('dlgNo').onclick=()=>done(false)})}
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}

const GLYPH={K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟'};

function sanFor(m,prevLegal,result){if(m.castle==='K'||m.castle==='k')return'O-O'+result;if(m.castle==='Q'||m.castle==='q')return'O-O-O'+result;const t=m.piece.toUpperCase();let s='';if(t!=='P'){s=t;const others=prevLegal.filter(x=>x.piece===m.piece&&x.to===m.to&&x.from!==m.from);if(others.length){const sf=others.some(x=>(x.from&7)===(m.from&7));const sr=others.some(x=>(x.from>>3)===(m.from>>3));if(!sf)s+=FILES[m.from&7];else if(!sr)s+=String(8-(m.from>>3));else s+=FILES[m.from&7]+String(8-(m.from>>3))}}if(m.captured){if(t==='P')s+=FILES[m.from&7];s+='x'}s+=FILES[m.to&7]+String(8-(m.to>>3));if(m.promo)s+='='+m.promo;return s+result}

let AC=null;
function ac(){if(!AC)AC=new(window.AudioContext||window.webkitAudioContext)();if(AC.state==='suspended')AC.resume();return AC}
function snd(kind){if(S.sound!=='on')return;try{const c=ac(),t=c.currentTime;const tone=(f,d,type,v,dt)=>{const o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.type=type;o.frequency.value=f;g.gain.setValueAtTime(v,t+dt);g.gain.exponentialRampToValueAtTime(.001,t+dt+d);o.start(t+dt);o.stop(t+dt+d+.02)};if(kind==='move')tone(520,.05,'triangle',.12,0);else if(kind==='capture'){tone(240,.06,'square',.10,0);tone(180,.05,'square',.08,.02)}else if(kind==='check'){tone(740,.09,'triangle',.12,0);tone(988,.1,'triangle',.1,.1)}else if(kind==='end'){tone(523,.12,'triangle',.12,0);tone(659,.12,'triangle',.12,.13);tone(784,.2,'triangle',.12,.26)}else if(kind==='click')tone(660,.03,'triangle',.06,0)}catch(e){}}

const S=Object.assign({opp:'computer',level:'medium',color:'white',clock:'off',theme:'green',sound:'on',wake:'on'},store.get('chess.settings',{}));
function applySettingsUI(){document.body.dataset.theme=S.theme;$('grpLevel').style.display=S.opp==='computer'?'':'none';$('grpColor').style.display=(S.opp==='two'||S.opp==='local')?'':'none';$('grpOnline').classList.toggle('hidden',S.opp!=='online');$('grpLocal').classList.toggle('hidden',S.opp!=='local');$('btnStart').style.display=(S.opp==='online'||S.opp==='local')?'none':'';updateWakeLock()}
document.querySelectorAll('.seg').forEach(seg=>{seg.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===S[seg.dataset.key]));seg.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const key=seg.dataset.key;S[key]=b.dataset.v;seg.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));applySettingsUI();store.set('chess.settings',S);if(key==='theme'&&G.screen==='menu')renderDemo();snd('click')})});

const G={screen:'menu',mode:'computer',level:2,humanColor:'w',opts:null,clockOn:false,baseMin:0,incSec:0,clocks:{w:0,b:0},st:initialState(),history:[],posMap:new Map(),legalCache:[],over:null,selected:-1,legalTargets:[],lastMove:null,hint:null,viewIndex:null,pendingPromo:null,flipped:false};
let thinkToken=0,saveTimer=0,selectedSaveId=null;

const boardEl=$('board'),cells=[];
(function buildBoard(){for(let i=0;i<64;i++){const d=document.createElement('div');d.className='cell';d.addEventListener('click',()=>{if(!suppressClick)onSquare(+d.dataset.sq)});boardEl.appendChild(d);cells.push(d)}})();
boardEl.addEventListener('contextmenu',e=>e.preventDefault());

function render(){const len=G.history.length;const k=G.viewIndex==null?len:G.viewIndex;const b=k>=len?G.st.board:G.history[k].snapshot.board;const lm=k>0?G.history[k-1].m:null;const live=G.viewIndex==null;const sel=live?G.selected:-1;const targets=live?G.legalTargets:[];let chkSq=-1;if(live&&!G.over&&inCheck(G.st,G.st.turn))chkSq=kingSq(G.st.board,G.st.turn);for(let i=0;i<64;i++){const sq=G.flipped?63-i:i,el=cells[i];const row=sq>>3,col=sq&7;let cls='cell '+(((row+col)%2===1)?'d':'l');if(lm&&(sq===lm.from||sq===lm.to))cls+=' lm';if(sq===sel)cls+=' sel';if(chkSq===sq)cls+=' chk';if(live&&G.hint&&(sq===G.hint.from||sq===G.hint.to))cls+=' hint';el.className=cls;el.dataset.sq=sq;const p=b[sq];let h=p?`<span class="p ${p<'a'?'pw':'pb'}">${GLYPH[p.toUpperCase()]}</span>`:'';if(targets.includes(sq))h+=`<i class="dot${b[sq]?' cap':''}"></i>`;if((i&7)===0)h+=`<b class="cr">${8-row}</b>`;if((i>>3)===7)h+=`<b class="cf">${FILES[col]}</b>`;el.innerHTML=h}$('viewTag').classList.toggle('hidden',live)}

function onSquare(sq){if(G.over||isNaN(sq))return;if(G.viewIndex!=null){setView(null);return}if(G.pendingPromo)return;const myTurn=(G.mode==='online'||G.mode==='local')?G.st.turn===O.color:(G.mode==='two'||G.st.turn===G.humanColor);if(!myTurn)return;if(G.selected>=0){const mv=G.legalCache.filter(m=>m.from===G.selected&&m.to===sq);if(mv.length){if(mv.some(x=>x.promo))openPromo(mv);else pushMove(mv[0]);return}}const p=G.st.board[sq];if(p&&(p<'a'?'w':'b')===G.st.turn){G.selected=sq;G.legalTargets=G.legalCache.filter(m=>m.from===sq).map(m=>m.to)}else{G.selected=-1;G.legalTargets=[]}render()}

function openPromo(moves){G.pendingPromo=moves;const w=G.st.turn==='w',box=$('promoBtns');box.innerHTML='';['Q','R','B','N'].forEach(pp=>{const b=document.createElement('button');b.innerHTML=`<span class="${w?'pw':'pb'}">${GLYPH[pp]}</span>`;b.onclick=()=>{const m=moves.find(x=>x.promo===pp);closePromo();pushMove(m)};box.appendChild(b)});$('promo').classList.remove('hidden')}
function closePromo(){if(!G.pendingPromo)return;G.pendingPromo=null;$('promo').classList.add('hidden');G.selected=-1;G.legalTargets=[];render()}

let drag=null,suppressClick=false;
function sqFromPoint(x,y){const r=boardEl.getBoundingClientRect();if(x<r.left||x>r.right||y<r.top||y>r.bottom)return null;const csz=r.width/8;const cell=Math.floor((y-r.top)/csz)*8+Math.floor((x-r.left)/csz);return G.flipped?63-cell:cell}
boardEl.addEventListener('pointerdown',e=>{if(G.screen!=='game'||G.over||G.pendingPromo)return;if(G.viewIndex!=null){setView(null);return}const myTurn=(G.mode==='online'||G.mode==='local')?G.st.turn===O.color:(G.mode==='two'||G.st.turn===G.humanColor);if(!myTurn)return;const cell=e.target.closest('.cell');if(!cell)return;const sq=+cell.dataset.sq;const p=G.st.board[sq];if(p&&(p<'a'?'w':'b')===G.st.turn){drag={sq,x:e.clientX,y:e.clientY,moved:false,fl:null};G.selected=sq;G.legalTargets=G.legalCache.filter(m=>m.from===sq).map(m=>m.to);render();try{boardEl.setPointerCapture(e.pointerId)}catch(err){}}});
boardEl.addEventListener('pointermove',e=>{if(!drag)return;if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>12){drag.moved=true;const p=G.st.board[drag.sq];const fl=document.createElement('div');fl.className='floatP '+(p<'a'?'pw':'pb');fl.textContent=GLYPH[p.toUpperCase()];fl.style.fontSize=(boardEl.getBoundingClientRect().width/8*0.9)+'px';document.body.appendChild(fl);drag.fl=fl;cells[G.flipped?63-drag.sq:drag.sq].classList.add('dragSrc')}if(drag.moved&&drag.fl){drag.fl.style.left=e.clientX+'px';drag.fl.style.top=e.clientY+'px'}});
function endDrag(e){if(!drag)return;const d=drag;drag=null;if(d.fl)d.fl.remove();cells[G.flipped?63-d.sq:d.sq].classList.remove('dragSrc');if(d.moved){suppressClick=true;setTimeout(()=>suppressClick=false,60);const sq=sqFromPoint(e.clientX,e.clientY);if(sq!=null&&sq!==d.sq){const mv=G.legalCache.filter(m=>m.from===d.sq&&m.to===sq);if(mv.length){if(mv.some(x=>x.promo))openPromo(mv);else pushMove(mv[0]);return}}G.selected=-1;G.legalTargets=[];render()}}
boardEl.addEventListener('pointerup',endDrag);
boardEl.addEventListener('pointercancel',endDrag);

function nameFor(c){if(G.mode==='online'||G.mode==='local'){const ps=(O.room&&O.room.players)||{};if(c===O.color)return O.nick+' (you)';const p=ps[c];let n=p&&p.name?p.name:'Opponent';if(O.room&&O.room.presence&&O.room.presence[c]===true)n+=' ⚠ offline';return n}if(G.mode==='two')return c==='w'?'White':'Black';return c===G.humanColor?'You':'Computer · '+LEVEL_NAMES[G.level]}
function capturedBy(){const r={w:[],b:[]};for(const h of G.history)if(h.m.captured)r[h.snapshot.turn].push(h.m.captured);return r}
function fillBar(nameEl,capsEl,advEl,barEl,c,caps){nameEl.textContent=nameFor(c);const mine=caps[c],theirs=caps[c==='w'?'b':'w'];const order={q:1,r:2,b:3,n:4,p:5};mine.sort((a,b)=>order[a.toLowerCase()]-order[b.toLowerCase()]);capsEl.innerHTML=mine.map(p=>`<span class="${p<'a'?'pw':'pb'}">${GLYPH[p.toUpperCase()]}</span>`).join('');const mv=mine.reduce((s,p)=>s+VAL[p.toLowerCase()],0);const tv=theirs.reduce((s,p)=>s+VAL[p.toLowerCase()],0);const d=Math.round((mv-tv)/100);advEl.textContent=d>0?'+'+d:'';barEl.classList.toggle('active',!G.over&&G.screen==='game'&&G.st.turn===c)}
function updateBars(){const bc=G.flipped?'b':'w',tc=bc==='w'?'b':'w',caps=capturedBy();fillBar($('bottomNameTxt'),$('bottomCaps'),$('bottomAdv'),$('bottomBar'),bc,caps);fillBar($('topNameTxt'),$('topCaps'),$('topAdv'),$('topBar'),tc,caps);$('topClk').style.display=$('bottomClk').style.display=G.clockOn?'':'none';updateClocks()}
function fmtClk(ms){ms=Math.max(0,ms);if(ms<10000)return Math.floor(ms/1000)+'.'+Math.floor(ms%1000/100);const s=Math.floor(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
function updateClocks(){if(!G.clockOn)return;const bc=G.flipped?'b':'w',tc=bc==='w'?'b':'w';$('bottomClk').textContent=fmtClk(G.clocks[bc]);$('topClk').textContent=fmtClk(G.clocks[tc]);$('bottomClk').classList.toggle('low',G.clocks[bc]<20000);$('topClk').classList.toggle('low',G.clocks[tc]<20000)}
function thinkingUI(on){$('topThink').classList.toggle('hidden',!on)}
function updateToolbar(){const on=G.mode==='online'||G.mode==='local';$('btnUndo').classList.toggle('hidden',on);$('btnHint').classList.toggle('hidden',on);$('btnSave').classList.toggle('hidden',on);$('btnRestart').classList.toggle('hidden',on);$('btnTakeback').classList.toggle('hidden',!on);$('btnChat').classList.toggle('hidden',!on);$('btnResign').classList.toggle('hidden',!on)}

function newGame(o,flags={}){G.opts={...o};G.mode=o.mode;G.level=o.level;G.humanColor=o.mode==='two'?'w':o.color;G.clockOn=o.clockMin>0;G.baseMin=o.clockMin;G.incSec=o.incSec;G.st=initialState();G.history=[];G.posMap=new Map([[positionKey(G.st),1]]);G.over=null;G.selected=-1;G.legalTargets=[];G.lastMove=null;G.viewIndex=null;G.hint=null;G.pendingPromo=null;G.flipped=(G.mode==='computer'&&G.humanColor==='b')||(G.mode==='online'&&o.color==='b')||(G.mode==='local'&&o.color==='b');G.clocks={w:G.baseMin*60000,b:G.baseMin*60000};G.legalCache=legalMoves(G.st);thinkToken++;thinkingUI(false);closePromo();hideBanner();closeSheet();closeChat();showScreen('game');updateToolbar();render();updateBars();buildMovesList();updateTakebackBtn();if(!flags.noAI&&G.mode==='computer'&&G.st.turn!==G.humanColor)aiTurn()}

function pushMove(m,opts={}){
  if(G.over)return;
  const prev=cloneState(G.st),prevLegal=G.legalCache;
  doMove(G.st,m);
  /* FIXED: moves were never sent to the opponent — online/local games could not work */
  if(!opts.remote){
    if(G.mode==='online')sendMoveToRoom(m);
    else if(G.mode==='local')localSend({type:'move',move:{from:m.from,to:m.to,promo:m.promo||''}});
  }
  const oppLegal=legalMoves(G.st);
  const chk=inCheck(G.st,G.st.turn);
  let result='',over=null;
  if(!oppLegal.length){if(chk){result='#';over={type:'mate',winner:prev.turn}}else over={type:'stalemate'}}
  else if(G.st.half>=100)over={type:'draw',reason:'50-move rule'};
  else if(insufficient(G.st.board))over={type:'draw',reason:'insufficient material'};
  else{const key=positionKey(G.st),c=(G.posMap.get(key)||0)+1;G.posMap.set(key,c);if(c>=3)over={type:'draw',reason:'threefold repetition'}}
  if(!result&&chk)result='+'; /* FIXED: check '+' was missing in the move list */
  const san=sanFor(m,prevLegal,result);
  if(G.mode!=='online'&&G.mode!=='local'&&G.clockOn)G.clocks[prev.turn]+=G.incSec*1000;
  G.history.push({m,san,snapshot:prev,clocksAfter:{...G.clocks}});
  G.legalCache=over?[]:oppLegal;G.lastMove=m;G.selected=-1;G.legalTargets=[];G.hint=null;
  if(!opts.silent){
    if(!over){if(chk)snd('check');else if(m.captured)snd('capture');else snd('move')}
    if(!opts.remote&&navigator.vibrate){try{navigator.vibrate(8)}catch(e){}}
  }
  if(over){
    G.over=over;
    if(G.mode==='local'){if(!opts.remote)localSend({type:'result',result:over})}
    else if(G.mode==='online'&&!opts.remote)claimResult(over);
    endGame()
  }else{
    render();updateBars();updateTakebackBtn();
    if($('movesSheet').classList.contains('show'))buildMovesList();
    if(!opts.silent&&G.mode!=='online'&&G.mode!=='local')scheduleAutosave();
    if(!opts.silent&&!opts.remote&&G.mode==='computer'&&G.st.turn!==G.humanColor)aiTurn()
  }
}

/* ================= AI (runs in a Web Worker; graceful fallback to main thread) ================= */
let thinkReqId=0;
const pendingThink=new Map();
let aiWorker=null,workerFailed=false;
function getAIWorker(){
  if(workerFailed)return null;
  if(aiWorker)return aiWorker;
  try{
    const tail=`\nself.onmessage=e=>{const d=e.data;const st={board:d.state.board,turn:d.state.turn,castle:d.state.castle,ep:d.state.ep,half:d.state.half,full:d.state.full};const ctx=newCtx(1);const m=thinkMoveSync(st,d.level,ctx,d.ply||0);self.postMessage({id:d.id,move:m?{from:m.from,to:m.to,promo:m.promo||''}:null});};`;
    const src=document.getElementById('engine').textContent+tail;
    aiWorker=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})));
    aiWorker.onmessage=e=>{
      const cb=pendingThink.get(e.data.id);
      if(!cb)return;
      pendingThink.delete(e.data.id);
      cb(e.data.move||null);
    };
    aiWorker.onerror=()=>{
      workerFailed=true;aiWorker=null;
      const pend=[...pendingThink.values()];
      pendingThink.clear();
      for(const cb of pend)cb(null);
    };
  }catch(e){workerFailed=true;return null}
  return aiWorker;
}
function thinkMove(st,level,cb){
  const w=getAIWorker();
  const id=++thinkReqId;
  if(w){
    pendingThink.set(id,cb);
    try{w.postMessage({id,level,ply:G.history.length,state:cloneState(st)})}
    catch(e){pendingThink.delete(id);fallbackThink(st,level,cb)}
    return;
  }
  fallbackThink(st,level,cb);
}
function fallbackThink(st,level,cb){
  setTimeout(()=>{
    try{const m=thinkMoveSync(cloneState(st),level,newCtx(1),G.history.length);cb(m)}
    catch(e){cb(null)}
  },30);
}

function aiTurn(){
  if(G.over)return;
  const tk=++thinkToken,snapLen=G.history.length;
  thinkingUI(true);
  thinkMove(G.st,G.level,m=>{
    if(tk!==thinkToken||G.over||G.screen!=='game'||G.history.length!==snapLen)return;
    thinkingUI(false);
    if(m&&G.legalCache.some(x=>x.from===m.from&&x.to===m.to&&(x.promo||'')===(m.promo||'')))pushMove(m);
    else setTimeout(()=>{if(tk===thinkToken&&!G.over&&G.screen==='game'&&G.history.length===snapLen&&G.st.turn!==G.humanColor)aiTurn()},400);
  });
}

function rebuildPosMap(){G.posMap=new Map();const add=k=>G.posMap.set(k,(G.posMap.get(k)||0)+1);for(const h of G.history)add(positionKey(h.snapshot));add(positionKey(G.st))}
function undo(){
  if(!G.history.length||G.pendingPromo)return;
  thinkToken++;thinkingUI(false);
  G.over=null;hideBanner();closePromo();
  if(G.mode==='computer'){
    while(G.history.length){const h=G.history.pop();G.st=cloneState(h.snapshot);if(G.st.turn===G.humanColor)break}
  }else{
    G.st=cloneState(G.history.pop().snapshot)
  }
  rebuildPosMap();G.legalCache=legalMoves(G.st);
  G.lastMove=G.history.length?G.history[G.history.length-1].m:null;
  G.clocks=G.history.length?{...G.history[G.history.length-1].clocksAfter}:{w:G.baseMin*60000,b:G.baseMin*60000};
  G.selected=-1;G.legalTargets=[];G.hint=null;G.viewIndex=null;
  render();updateBars();buildMovesList();scheduleAutosave();snd('click');
  /* FIXED: if undo leaves the computer to move (e.g. its very first move was undone),
     the game used to freeze — now the AI is re-triggered */
  if(G.mode==='computer'&&!G.over&&G.st.turn!==G.humanColor)aiTurn();
}
function flagFall(c){G.over={type:'timeout',winner:c==='w'?'b':'w'};endGame()}
function endGame(){thinkToken++;thinkingUI(false);closePromo();snd('end');render();updateBars();updateTakebackBtn();const o=G.over;const you=c=>G.mode==='computer'?(c===G.humanColor?'You win':'Computer wins'):(G.mode==='online'||G.mode==='local')?(c===O.color?'You win':(nameFor(c)+' wins')):(c==='w'?'White wins':'Black wins');let title='Draw',sub='';if(o.type==='mate'){title='Checkmate';sub=you(o.winner)}else if(o.type==='timeout'){title='Time out';sub=you(o.winner)}else if(o.type==='resign'){title='Resigned';sub=you(o.winner)}else if(o.type==='stalemate')sub='Stalemate';else sub=o.reason||'';$('bTitle').textContent=title;$('bSub').textContent=sub;$('btnRematch').textContent=(G.mode==='online'||G.mode==='local')?'Rematch (swap colors)':'Rematch';$('banner').classList.remove('hidden');store.del('chess.autosave')}
function hideBanner(){$('banner').classList.add('hidden')}
async function goMenu(){
  if(G.mode==='online'){if(!await confirmDlg('Leave the game? You can rejoin with code '+O.code))return}
  else if(G.mode==='local'){if(!await confirmDlg('Leave the game? The connection will be closed.'))return}
  thinkToken++;thinkingUI(false);closePromo();hideBanner();closeSheet();closeChat();
  if(G.mode==='online'||G.mode==='local'){leaveOnline()}
  else if(!G.over&&G.history.length)store.set('chess.autosave',serializeGame());
  showScreen('menu')
}

/* FIXED: clocks used to drift (fixed 200ms decrement) — now real elapsed time is subtracted */
let lastTickTs=Date.now();
setInterval(()=>{
  const now=Date.now();
  const dt=Math.min(Math.max(now-lastTickTs,0),1500);
  lastTickTs=now;
  if(G.screen!=='game'||G.over||!G.clockOn)return;
  if(G.mode==='online'||G.mode==='local'){const c=onlineClocks();if(c){G.clocks=c;updateClocks();if(c[G.st.turn]<=0)claimTimeout()}return}
  const t=G.st.turn;
  G.clocks[t]-=dt;
  if(G.clocks[t]<=0){G.clocks[t]=0;updateClocks();flagFall(t);return}
  updateClocks()
},200);

function serializeGame(){return{v:1,mode:G.mode,level:G.level,humanColor:G.humanColor,clockOn:G.clockOn,baseMin:G.baseMin,incSec:G.incSec,clocks:{w:Math.max(0,Math.round(G.clocks.w)),b:Math.max(0,Math.round(G.clocks.b))},moves:G.history.map(h=>[h.m.from,h.m.to,h.m.promo||'']),ts:Date.now()}}
function scheduleAutosave(){if(G.mode==='online'||G.mode==='local')return;clearTimeout(saveTimer);saveTimer=setTimeout(()=>idle(()=>{if(G.screen==='game'&&!G.over&&G.history.length&&G.mode!=='online'&&G.mode!=='local')store.set('chess.autosave',serializeGame())}),800)}
function saveNow(){if(G.screen==='game'&&!G.over&&G.history.length&&G.mode!=='online'&&G.mode!=='local')store.set('chess.autosave',serializeGame())}
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveNow();else{wakeLock=null;updateWakeLock()}});
window.addEventListener('pagehide',saveNow);

let wakeLock=null;
async function updateWakeLock(){const want=S.wake!=='off'&&G.screen==='game'&&!document.hidden;try{if(want&&!wakeLock&&navigator.wakeLock){wakeLock=await navigator.wakeLock.request('screen')}else if(!want&&wakeLock){wakeLock.release();wakeLock=null}}catch(e){}}

function buildMovesList(){const cur=G.viewIndex==null?G.history.length:G.viewIndex;const mvBtn=i=>`<button class="mv${(i+1)===cur?' cur':''}" data-i="${i}">${G.history[i].san}</button>`;let h='';if(!G.history.length)h='<div class="empty">No moves yet</div>';for(let i=0;i<G.history.length;i+=2){h+=`<div class="mrow"><span class="mnum">${i/2+1}.</span>${mvBtn(i)}`;h+=i+1<G.history.length?mvBtn(i+1):'<span></span>';h+='</div>'}$('movesList').innerHTML=h;if(G.viewIndex==null)$('movesList').scrollTop=$('movesList').scrollHeight;else{const c=$('movesList').querySelector('.cur');if(c)c.scrollIntoView({block:'nearest'})}}
$('movesList').addEventListener('click',e=>{const b=e.target.closest('.mv');if(!b)return;setView(+b.dataset.i+1)});
function setView(k){if(k==null||k>=G.history.length)G.viewIndex=null;else G.viewIndex=Math.max(0,k);render();buildMovesList()}
function toggleSheet(){const sh=$('movesSheet'),open=!sh.classList.contains('show');closeChat();sh.classList.toggle('show',open);if(open)buildMovesList();snd('click')}
function closeSheet(){$('movesSheet').classList.remove('show')}
$('btnMoves').onclick=toggleSheet;$('mvClose').onclick=closeSheet;$('mvFirst').onclick=()=>setView(0);$('mvPrev').onclick=()=>setView((G.viewIndex??G.history.length)-1);$('mvNext').onclick=()=>setView((G.viewIndex??G.history.length)+1);$('mvLast').onclick=()=>setView(null);

$('btnUndo').onclick=undo;
$('btnFlip').onclick=()=>{G.flipped=!G.flipped;render();snd('click')};
$('btnHint').onclick=()=>{
  if(G.over||G.pendingPromo)return;
  if(G.mode==='computer'&&G.st.turn!==G.humanColor){toast('Wait for your turn');return}
  if(pendingThink.size){toast('Engine is busy — try again in a second');return}
  const hl=G.history.length;
  thinkMove(G.st,3,m=>{
    if(!m||G.over||G.screen!=='game'||G.history.length!==hl)return;
    G.hint={from:m.from,to:m.to};render();
    setTimeout(()=>{if(G.hint){G.hint=null;render()}},1800)
  })
};
$('btnSave').onclick=()=>{if(G.over){toast('Game is finished');return}if(!G.history.length){toast('Nothing to save yet');return}const saves=store.get('chess.saves',[]);saves.unshift({id:Date.now(),data:serializeGame(),info:saveInfo()});while(saves.length>30)saves.pop();store.set('chess.saves',saves);selectedSaveId=null;toast('Game saved ✓')};
$('btnRestart').onclick=async()=>{if(!await confirmDlg('Restart this game?'))return;const o={...G.opts};if(o.randomColor)o.color=Math.random()<.5?'w':'b';newGame(o)};
$('btnMenu').onclick=goMenu;$('btnToMenu').onclick=goMenu;
$('btnRematch').onclick=()=>{
  if(G.mode==='online'){onlineRematch();return}
  if(G.mode==='local'){localRematch();return}
  hideBanner();const o={...G.opts};if(o.randomColor)o.color=Math.random()<.5?'w':'b';newGame(o)
};

function modeDesc(d){const clock=d.baseMin>0?` · ${d.baseMin}|${d.incSec}`:' · no clock';if(d.mode==='two')return'2 Players'+clock;if(d.mode==='local')return'Local Game'+clock;return'vs Computer · '+LEVEL_NAMES[d.level]+clock}
function saveInfo(){return{plies:G.history.length,turn:G.st.turn,desc:modeDesc(serializeGame())}}
function renderSavesPanel(){const saves=store.get('chess.saves',[]),el=$('savesList');if(!saves.length){el.innerHTML='<div class="savesEmpty">No saved games yet.<br>Use 💾 Save during a game.</div>';return}el.innerHTML='';saves.forEach(s=>{const d=document.createElement('button');d.className='saveItem'+(s.id===selectedSaveId?' sel':'');const date=new Date(s.data.ts);const when=date.toLocaleDateString()+' '+date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});const mv=Math.floor(s.info.plies/2)+1;d.innerHTML=`<span class="si"><span class="a">${s.info.desc}</span><br><span class="b">${when} · move ${mv} · ${s.info.turn==='w'?'White':'Black'} to play</span></span><span class="del">✕</span>`;d.onclick=()=>{selectedSaveId=selectedSaveId===s.id?null:s.id;renderSavesPanel();snd('click')};d.querySelector('.del').onclick=e=>{e.stopPropagation();store.set('chess.saves',store.get('chess.saves',[]).filter(x=>x.id!==s.id));if(selectedSaveId===s.id)selectedSaveId=null;renderSavesPanel()};el.appendChild(d)})}
$('btnSaves').onclick=()=>{const p=$('savesPanel');p.classList.toggle('open');$('btnSaves').textContent=p.classList.contains('open')?'Saved games ▴':'Saved games ▾';if(p.classList.contains('open'))renderSavesPanel();snd('click')};
function setContinueLabel(){const a=store.get('chess.autosave',null);$('btnContinue').innerHTML=a&&a.moves&&a.moves.length?`Continue game<small>Unfinished game · move ${Math.floor(a.moves.length/2)+1}</small>`:'Continue game'}
function loadSerialized(d){try{newGame({mode:d.mode,level:d.level,color:d.humanColor,clockMin:d.baseMin,incSec:d.incSec,randomColor:false},{noAI:true});for(const[from,to,promo]of d.moves){const m=G.legalCache.find(x=>x.from===from&&x.to===to&&((x.promo||'')===(promo||'')));if(!m)return false;pushMove(m,{silent:true});if(G.over)break}if(d.clocks)G.clocks={...d.clocks};updateBars();render();if(!G.over&&G.mode==='computer'&&G.st.turn!==G.humanColor)aiTurn();scheduleAutosave();return true}catch(e){return false}}
$('btnContinue').onclick=()=>{let data=null;if(selectedSaveId){const saves=store.get('chess.saves',[]);const s=saves.find(x=>x.id===selectedSaveId);if(s){data=s.data;store.set('chess.saves',saves.filter(x=>x.id!==s.id));selectedSaveId=null}}else{data=store.get('chess.autosave',null)}if(!data){toast('No saved game to continue');return}if(!loadSerialized(data)){showScreen('menu');toast('Could not load that save')}};

$('btnStart').onclick=()=>{if(S.opp==='online'||S.opp==='local')return;const lvl={easy:1,medium:2,hard:3,expert:4}[S.level];const color=S.color==='white'?'w':S.color==='black'?'b':(Math.random()<.5?'w':'b');const[min,inc]=S.clock==='off'?[0,0]:S.clock.split('|').map(Number);newGame({mode:S.opp==='two'?'two':'computer',level:lvl,color,clockMin:min,incSec:inc,randomColor:S.color==='random'})};
function showScreen(name){G.screen=name;$('menuScreen').classList.toggle('hidden',name!=='menu');$('gameScreen').classList.toggle('hidden',name!=='game');if(name==='menu'){startDemo();renderSavesPanel();setContinueLabel();$('onlineStatus').classList.add('hidden');$('localStatus').classList.add('hidden')}else stopDemo();updateWakeLock()}

const DEMO_COLORS={green:['#e9edcf','#739552'],wood:['#f0d9b5','#b58863'],ocean:['#d9e4ec','#4e7a9b'],slate:['#d3d8dd','#5f6b76']};
const demoCv=$('demoCanvas'),demoCtx=demoCv.getContext('2d');
const demo={st:null,keys:new Map(),last:null,timer:0,vw:0,vh:0};
function demoNew(){demo.st=initialState();demo.keys=new Map([[positionKey(demo.st),1]]);demo.last=null}
function demoPick(st,legal){let best=legal[0],bs=-Infinity;for(const m of legal){const u=doMove(st,m);let sc=-evaluate(st);undoMove(st,u);sc+=(Math.random()*2-1)*70;if(m.captured)sc+=8;if(sc>bs){bs=sc;best=m}}return best}
function demoStep(){if(document.hidden||G.screen!=='menu'||!demo.st)return;const st=demo.st;const legal=legalMoves(st);const rep=demo.keys.get(positionKey(st))||0;if(!legal.length||rep>=3||st.half>=80||st.full>140){demoNew();renderDemo();return}const m=demoPick(st,legal);doMove(st,m);demo.last=m;const k=positionKey(st);demo.keys.set(k,(demo.keys.get(k)||0)+1);renderDemo()}
function renderDemo(){if(!demo.vw)return;const ctx=demoCtx,vw=demo.vw,vh=demo.vh;ctx.clearRect(0,0,vw,vh);const csz=Math.min(vw,vh)/8*1.12;const ox=(vw-csz*8)/2,oy=(vh-csz*8)/2;const[lc,dc]=DEMO_COLORS[S.theme]||DEMO_COLORS.green;const st=demo.st||initialState();for(let s=0;s<64;s++){const r=s>>3,c=s&7;ctx.fillStyle=((r+c)%2===1)?dc:lc;ctx.fillRect(ox+c*csz,oy+r*csz,csz+1,csz+1)}if(demo.last){ctx.fillStyle='rgba(255,213,79,.35)';for(const sq of[demo.last.from,demo.last.to])ctx.fillRect(ox+(sq&7)*csz,oy+(sq>>3)*csz,csz,csz)}ctx.font=`${csz*0.74}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';for(let s=0;s<64;s++){const p=st.board[s];if(!p)continue;ctx.fillStyle=p<'a'?'#f5f5f0':'#17181c';ctx.fillText(GLYPH[p.toUpperCase()],ox+(s&7)*csz+csz/2,oy+(s>>3)*csz+csz/2+csz*0.03)}}
function sizeDemo(){const r=demoCv.getBoundingClientRect();const dpr=Math.min(window.devicePixelRatio||1,1.5);demoCv.width=Math.max(1,r.width*dpr);demoCv.height=Math.max(1,r.height*dpr);demoCtx.setTransform(dpr,0,0,dpr,0,0);demo.vw=r.width;demo.vh=r.height;renderDemo()}
function startDemo(){if(!demo.st)demoNew();renderDemo();if(!demo.timer)demo.timer=setInterval(demoStep,2000)}
function stopDemo(){clearInterval(demo.timer);demo.timer=0}
window.addEventListener('resize',sizeDemo);

const FB={key:'AIzaSyA-podPR1kLzUQdMWwm0yT0nzWbyWUYH9w',project:'chess-e5ed6',urls:['https://chess-e5ed6-default-rtdb.firebaseio.com','https://chess-e5ed6-default-rtdb.europe-west1.firebasedatabase.app','https://chess-e5ed6-default-rtdb.europe-west2.firebasedatabase.app','https://chess-e5ed6-default-rtdb.europe-west3.firebasedatabase.app','https://chess-e5ed6-default-rtdb.europe-west4.firebasedatabase.app','https://chess-e5ed6-default-rtdb.asia-southeast1.firebasedatabase.app','https://chess-e5ed6-default-rtdb.asia-northeast1.firebasedatabase.app','https://chess-e5ed6-default-rtdb.southamerica-east1.firebasedatabase.app','https://chess-e5ed6-default-rtdb.australia-southeast1.firebasedatabase.app'],db:null};
const O={uid:store.get('chess.uid',null)||(()=>{const u='u'+Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);store.set('chess.uid',u);return u})(),nick:store.get('chess.nick','Player'),mode:null,code:null,color:null,roomRef:null,room:null,entered:false,serverOffset:0,claimed:false,lastReset:0,tbSeen:0,chatSeen:0,busy:false,rtc:null,dc:null};
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s)})}
async function initFirebase(){if(FB.db)return FB.db;toast('Connecting to server…');await loadScript('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');await loadScript('https://www.gstatic.com/firebasejs/10.12.5/firebase-database-compat.js');for(const url of FB.urls){try{const app=firebase.initializeApp({apiKey:FB.key,projectId:FB.project,databaseURL:url});const db=firebase.database(app);const ok=await new Promise(res=>{const t=setTimeout(()=>res(false),4500);const ref=db.ref('.info/connected');ref.on('value',function cb(v){if(v.val()===true){clearTimeout(t);ref.off('value',cb);res(true)}})});if(ok){FB.db=db;return db}await app.delete()}catch(e){try{if(firebase.apps.length)await firebase.app().delete()}catch(_){}}}throw new Error('db unreachable')}
function genCode(){const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';let s='';for(let i=0;i<5;i++)s+=A[(Math.random()*A.length)|0];return s}
function roomMoves(room){if(!room||!room.moves)return[];return Object.keys(room.moves).map(Number).sort((a,b)=>a-b).map(k=>room.moves[k])}
function showWaitingUI(code){const el=$('onlineStatus');el.classList.remove('hidden');el.innerHTML=`Room code: <b class="roomCode">${code}</b> <button class="mini" id="btnCopyCode">copy</button><br>Waiting for opponent… <button class="mini" id="btnCancelRoom">Cancel</button>`;$('btnCopyCode').onclick=()=>{try{navigator.clipboard.writeText(code);toast('Code copied')}catch(e){toast(code)}};$('btnCancelRoom').onclick=()=>{if(O.roomRef){try{O.roomRef.remove()}catch(e){}}leaveOnline();el.classList.add('hidden');toast('Room cancelled')}}

$('btnCreateRoom').onclick=async()=>{if(O.busy)return;O.busy=true;O.nick=$('nickInput').value.trim()||'Player';store.set('chess.nick',O.nick);try{const db=await initFirebase();let code=$('roomNameInput').value.trim().toUpperCase()||genCode(),ref=db.ref('rooms/'+code);for(let i=0;i<3;i++){const s=await ref.once('value');if(!s.exists())break;code=$('roomNameInput').value.trim().toUpperCase()||genCode();ref=db.ref('rooms/'+code)}const customMin=parseInt($('customMinInput').value)||10;const customInc=parseInt($('customIncInput').value)||0;const res=await ref.transaction(cur=>{if(cur)return;return{v:1,status:'waiting',createdAt:firebase.database.ServerValue.TIMESTAMP,clock:{on:true,base:customMin,inc:customInc},players:{},moveCount:0,roomName:$('roomNameInput').value.trim()||''}});if(!res.committed){toast('Could not create room');return}const color=S.color==='white'?'w':S.color==='black'?'b':(Math.random()<.5?'w':'b');await ref.child('players/'+color).set({uid:O.uid,name:O.nick});O.mode='host';O.code=code;O.color=color;O.roomRef=ref;O.entered=false;showWaitingUI(code);subscribeRoom();toast('Room created — share the code with your friend')}catch(e){toast('Connection failed. Check internet and Firebase setup.')}finally{O.busy=false}};

$('btnJoinRoom').onclick=async()=>{if(O.busy)return;const code=$('joinInput').value.trim().toUpperCase();if(code.length<1){toast('Enter the room code');return}O.busy=true;O.nick=$('nickInput').value.trim()||'Player';store.set('chess.nick',O.nick);try{const db=await initFirebase();const ref=db.ref('rooms/'+code);let joinedColor=null;const res=await ref.transaction(room=>{if(!room)return;if(room.status==='waiting'){const tw=room.players&&room.players.w,tb=room.players&&room.players.b;if(tw&&tb)return;const c=tw?'b':'w';room.players=room.players||{};room.players[c]={uid:O.uid,name:O.nick};room.status='playing';room.startedAt=firebase.database.ServerValue.TIMESTAMP;room.lastMoveAt=firebase.database.ServerValue.TIMESTAMP;room.clocks={w:(room.clock.base||0)*60000,b:(room.clock.base||0)*60000};joinedColor=c}else if(room.status==='playing'){const mine=['w','b'].some(c=>room.players&&room.players[c]&&room.players[c].uid===O.uid);if(!mine)return}else return;return room});if(!res.committed){toast('Room not found, full, or finished');return}O.mode='guest';O.code=code;O.roomRef=ref;O.entered=false;const snap=await ref.once('value');const room=snap.val();O.room=room;subscribeRoom();enterOnlineGame(room)}catch(e){toast('Connection failed. Check internet and Firebase setup.')}finally{O.busy=false}};

function subscribeRoom(){if(!O.roomRef)return;O.roomRef.on('value',s=>{const room=s.exists()?s.val():null;O.room=room;if(!room){if(G.mode==='online'){toast('Room closed');leaveOnline();showScreen('menu')}return}if(G.screen==='menu'&&O.mode==='host'){if(room.status==='playing'&&room.players&&room.players.w&&room.players.b)enterOnlineGame(room)}else if(G.mode==='online'){reconcileRoom(room)}});const db=O.roomRef.database;db.ref('.info/serverTimeOffset').on('value',v=>O.serverOffset=v.val()||0);db.ref('.info/connected').on('value',v=>{if(v.val()===true&&O.color){const p=O.roomRef.child('presence/'+O.color);p.onDisconnect().set(true);p.set(false)}})}

function enterOnlineGame(room){if(O.entered||!room)return;const ps=room.players||{};let color=null;for(const c of['w','b'])if(ps[c]&&ps[c].uid===O.uid)color=c;if(!color){toast('You are not a player in this room');return}O.entered=true;O.room=room;O.color=color;O.claimed=false;O.lastReset=0;O.tbSeen=0;O.chatSeen=0;const base=room.clock?room.clock.base||0:0,inc=room.clock?room.clock.inc||0:0;newGame({mode:'online',level:1,color,clockMin:base,incSec:inc,randomColor:false},{noAI:true});G.clockOn=!!(room.clock&&room.clock.on);if(room.clocks)G.clocks={...room.clocks};for(const rm of roomMoves(room)){if(G.over)break;const m=G.legalCache.find(x=>x.from===rm.from&&x.to===rm.to&&((x.promo||'')===(rm.promo||'')));if(m)pushMove(m,{remote:true,silent:true})}updateBars();render();updateTakebackBtn();if(room.result){G.over=room.result;endGame()}toast('Connected · you play '+(color==='w'?'White':'Black'))}

function reconcileRoom(room){if(G.mode!=='online'||G.screen!=='game')return;const moves=roomMoves(room);if(moves.length<G.history.length)truncateHistory(moves.length);let guard=0;while(G.history.length<moves.length&&!G.over&&guard++<500){const rm=moves[G.history.length];const m=G.legalCache.find(x=>x.from===rm.from&&x.to===rm.to&&((x.promo||'')===(rm.promo||'')));if(!m)break;pushMove(m,{remote:true})}if(room.clocks&&room.clock&&room.clock.on)G.clocks={...room.clocks};if(room.result&&!G.over){G.over=room.result;endGame()}if(room.reset&&(room.reset.at||0)>(O.lastReset||0)){O.lastReset=room.reset.at;O.color=O.color==='w'?'b':'w';O.claimed=false;hideBanner();const base=room.clock?room.clock.base||0:0,inc=room.clock?room.clock.inc||0:0;newGame({mode:'online',level:1,color:O.color,clockMin:base,incSec:inc,randomColor:false},{noAI:true});G.clockOn=!!(room.clock&&room.clock.on);toast('Rematch — colors swapped')}if(room.takeback&&room.takeback.by!==O.color&&(room.takeback.at||0)>(O.tbSeen||0)){O.tbSeen=room.takeback.at;confirmDlg('Opponent asks to take back their move. Accept?').then(ok=>takebackRespond(ok))}updateChatBadge(room);updateBars();updateTakebackBtn()}

function truncateHistory(n){while(G.history.length>n){const h=G.history.pop();G.st=cloneState(h.snapshot)}rebuildPosMap();G.legalCache=legalMoves(G.st);G.lastMove=G.history.length?G.history[G.history.length-1].m:null;G.selected=-1;G.legalTargets=[];G.hint=null;render();updateBars();buildMovesList()}

function sendMoveToRoom(m){if(!O.roomRef)return;O.roomRef.transaction(room=>{if(!room||room.result)return;const idx=room.moveCount||0;const mover=idx%2===0?'w':'b';const now=Date.now()+(O.serverOffset||0);if(room.clock&&room.clock.on){room.clocks=room.clocks||{w:(room.clock.base||0)*60000,b:(room.clock.base||0)*60000};const elapsed=Math.max(0,now-(room.lastMoveAt||now));room.clocks[mover]=Math.max(0,room.clocks[mover]-elapsed+(room.clock.inc||0)*1000)}room.moves=room.moves||{};room.moves[idx]={from:m.from,to:m.to,promo:m.promo||'',cw:room.clocks?room.clocks.w:0,cb:room.clocks?room.clocks.b:0};room.moveCount=idx+1;room.lastMoveAt=firebase.database.ServerValue.TIMESTAMP;room.takeback=null;return room},(err,committed)=>{if(err||!committed)toast('Move not sent — check connection')})}

function onlineClocks(){const room=O.room;if(!room||!room.clocks)return{...G.clocks};const now=Date.now()+(O.serverOffset||0);const elapsed=Math.max(0,now-(room.lastMoveAt||now));const out={w:room.clocks.w,b:room.clocks.b};out[G.st.turn]-=elapsed;return out}

function claimResult(result){if(!O.roomRef)return;O.roomRef.transaction(room=>{if(!room||room.result)return;room.result=result;room.status='over';return room})}
function claimTimeout(){
  if(G.over)return;
  if(G.mode==='local'){ /* FIXED: timeout now also ends local games (used to silently do nothing) */
    const r={type:'timeout',winner:G.st.turn==='w'?'b':'w'};
    localSend({type:'result',result:r});
    G.over=r;endGame();return;
  }
  if(O.claimed)return;O.claimed=true;
  claimResult({type:'timeout',winner:G.st.turn==='w'?'b':'w'});
}
function updateTakebackBtn(){const b=$('btnTakeback');if(G.mode!=='online')return;const own=O.room&&O.room.takeback&&O.room.takeback.by===O.color;const can=!G.over&&O.room&&!O.room.result&&G.st.turn===O.color&&G.history.length>=2;b.textContent=own?'↩ Cancel request':'↩ Takeback';b.style.opacity=(can||own)?1:.4;b.disabled=!(can||own)}
$('btnTakeback').onclick=()=>{if(!O.roomRef)return;if(O.room&&O.room.takeback&&O.room.takeback.by===O.color){O.roomRef.child('takeback').set(null);return}if(!G.over&&O.room&&!O.room.result&&!O.room.takeback&&G.st.turn===O.color&&G.history.length>=2){O.roomRef.transaction(room=>{if(!room||room.result||room.takeback)return;room.takeback={by:O.color,at:firebase.database.ServerValue.TIMESTAMP};return room});toast('Takeback request sent')}};
function takebackRespond(accept){if(!O.roomRef)return;O.roomRef.transaction(room=>{if(!room||!room.takeback)return;if(accept){const n=room.moveCount||0;if(n>=2&&room.moves){const rec=room.moves[n-2];delete room.moves[n-1];delete room.moves[n-2];room.moveCount=n-2;if(room.clock&&room.clock.on){room.clocks=rec?{w:rec.cw,b:rec.cb}:{w:(room.clock.base||0)*60000,b:(room.clock.base||0)*60000}}room.lastMoveAt=firebase.database.ServerValue.TIMESTAMP}}room.takeback=null;return room})}
$('btnResign').onclick=async()=>{
  if(G.over)return;
  if(!await confirmDlg('Resign this game?'))return;
  const r={type:'resign',winner:O.color==='w'?'b':'w'};
  if(G.mode==='local'){localSend({type:'result',result:r});G.over=r;endGame();return} /* FIXED for local games */
  claimResult(r);
};
function onlineRematch(){if(!O.roomRef)return;O.roomRef.transaction(room=>{if(!room||!room.result)return;room.moves={};room.moveCount=0;room.result=null;room.takeback=null;room.status='playing';room.clocks={w:(room.clock.base||0)*60000,b:(room.clock.base||0)*60000};room.lastMoveAt=firebase.database.ServerValue.TIMESTAMP;if(room.players){const w=room.players.w;room.players.w=room.players.b;room.players.b=w}room.reset={at:firebase.database.ServerValue.TIMESTAMP};return room})}
function localRematch(){
  O.color=O.color==='w'?'b':'w';
  newGame({mode:'local',level:1,color:O.color,clockMin:G.baseMin,incSec:G.incSec,randomColor:false},{noAI:true});
  localSend({type:'gameState',color:O.color,name:O.nick,min:G.baseMin,inc:G.incSec});
  toast('Rematch — colors swapped');
}
function leaveOnline(){if(O.roomRef){try{O.roomRef.off()}catch(e){}}O.mode=null;O.code=null;O.room=null;O.roomRef=null;O.entered=false;O.lastReset=0;O.tbSeen=0;O.chatSeen=0;O.claimed=false;if(O.dc){try{O.dc.close()}catch(e){}O.dc=null}if(O.rtc){try{O.rtc.close()}catch(e){}O.rtc=null}}

function chatCount(room){return room&&room.chat?Object.keys(room.chat).length:0}
function updateChatBadge(room){const n=chatCount(room);if($('chatSheet').classList.contains('show')){O.chatSeen=n;$('chatBadge').classList.add('hidden');renderChatList(room)}else{const unread=n-(O.chatSeen||0);$('chatBadge').textContent=unread>0?unread:'';$('chatBadge').classList.toggle('hidden',unread<=0)}}
function renderChatList(room){const keys=room&&room.chat?Object.keys(room.chat).sort():[];let h='';for(const k of keys.slice(-200)){const m=room.chat[k];const mine=m.color===O.color;h+=`<div class="msg ${mine?'me':''}"><b>${esc(m.name||'Player')}</b>${esc(m.text)}</div>`}$('chatList').innerHTML=h||'<div class="empty">No messages</div>';$('chatList').scrollTop=$('chatList').scrollHeight}
function toggleChat(){const sh=$('chatSheet'),open=!sh.classList.contains('show');closeSheet();sh.classList.toggle('show',open);if(open){O.chatSeen=chatCount(O.room);$('chatBadge').classList.add('hidden');renderChatList(O.room);setTimeout(()=>{try{$('chatInput').focus()}catch(e){}},250)}snd('click')}
function closeChat(){$('chatSheet').classList.remove('show')}
function addLocalChat(color,name,text){O.room=O.room||{chat:{}};O.room.chat=O.room.chat||{};O.room.chat['c'+Date.now()+Math.random().toString(36).slice(2,6)]={color,name,text};if($('chatSheet').classList.contains('show'))renderChatList(O.room);else updateChatBadge(O.room)}
function sendChat(){
  const t=$('chatInput').value.trim();
  if(!t)return;
  $('chatInput').value='';
  const text=t.slice(0,140);
  if(G.mode==='local'){ /* FIXED: chat now works in local games too */
    localSend({type:'chat',name:O.nick,color:O.color,text});
    addLocalChat(O.color,O.nick,text);
    return;
  }
  if(!O.roomRef)return;
  O.roomRef.child('chat').push({name:O.nick,color:O.color,text,t:firebase.database.ServerValue.TIMESTAMP});
}
$('btnChat').onclick=toggleChat;$('chatClose').onclick=closeChat;$('chatSend').onclick=sendChat;$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter')sendChat()});

/* ================= LOCAL P2P (WebRTC over hotspot) — FIXED SIGNALING =================
   The original flow could never connect: the host had no way to paste the guest's answer.
   Now both sides exchange codes through the same dialog. */
function localSend(obj){if(O.dc&&O.dc.readyState==='open'){try{O.dc.send(JSON.stringify(obj))}catch(e){}}}
function localMsg(e){
  let msg=null;try{msg=JSON.parse(e.data)}catch(err){return}
  if(!msg)return;
  if(msg.type==='move'){
    const mv=msg.move||{};
    const m=G.legalCache.find(x=>x.from===mv.from&&x.to===mv.to&&((x.promo||'')===(mv.promo||'')));
    if(m)pushMove(m,{remote:true});
  }else if(msg.type==='gameState'){
    const min=msg.min||10,inc=msg.inc||0;
    O.color=msg.color==='w'?'b':'w'; /* FIXED: guest color is derived from the host color */
    O.mode='local';O.code='LOCAL';
    O.room={clock:{base:min,inc:inc,on:min>0},players:{},moves:{},moveCount:0,chat:{}};
    O.room.players[msg.color]={name:msg.name||'Host'};
    O.room.players[O.color]={name:O.nick};
    newGame({mode:'local',level:1,color:O.color,clockMin:min,incSec:inc,randomColor:false},{noAI:true});
    $('localConnDlg').classList.add('hidden');
    toast('Connected · you play '+(O.color==='w'?'White':'Black'));
  }else if(msg.type==='chat'){
    addLocalChat(msg.color,msg.name||'Opponent',msg.text);
  }else if(msg.type==='result'){
    if(!G.over){G.over=msg.result;endGame()}
  }
}
$('btnLocalHost').onclick=async()=>{
  if(O.busy)return;O.busy=true;
  O.nick=$('nickInput').value.trim()||'Player';store.set('chess.nick',O.nick);
  try{
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
    O.rtc=pc;
    const dc=pc.createDataChannel('chess');O.dc=dc;
    dc.onmessage=localMsg;
    dc.onopen=()=>{
      $('localConnDlg').classList.add('hidden');
      toast('Connected! Starting game…');
      const color=S.color==='white'?'w':S.color==='black'?'b':(Math.random()<.5?'w':'b');
      O.color=color;O.mode='local';O.code='LOCAL';
      const min=parseInt($('customMinInput').value)||10;const inc=parseInt($('customIncInput').value)||0;
      O.room={clock:{base:min,inc:inc,on:min>0},players:{},moves:{},moveCount:0,chat:{}};
      O.room.players[color]={name:O.nick};
      O.room.players[color==='w'?'b':'w']={name:'Guest'};
      newGame({mode:'local',level:1,color,clockMin:min,incSec:inc,randomColor:false},{noAI:true});
      localSend({type:'gameState',color,name:O.nick,min,inc});
    };
    dc.onclose=()=>{if(O.mode==='local'){toast('Connection closed');leaveOnline();showScreen('menu')}};
    const cands=[];
    pc.onicecandidate=e=>{if(e.candidate)cands.push(e.candidate)};
    const offer=await pc.createOffer();
    await pc.setLocalDescription(offer);
    $('localDlgTitle').textContent='Create Local Game';
    $('localDlgHint').textContent='Send this code to the other player. When they reply, paste their code below and press Connect.';
    $('localDlgCode').value='Gathering connection info…';
    $('localDlgCode').classList.remove('hidden');
    $('localDlgIn').value='';$('localDlgIn').classList.remove('hidden');
    $('localDlgConnect').textContent='Connect';$('localDlgConnect').disabled=false;$('localDlgConnect').classList.remove('hidden');
    $('localConnDlg').classList.remove('hidden');
    setTimeout(()=>{
      if(O.rtc===pc){$('localDlgCode').value=JSON.stringify({t:'o',sdp:pc.localDescription,c:cands})}
      try{navigator.clipboard.writeText($('localDlgCode').value)}catch(e){}
    },1500);
  }catch(e){toast('Failed to create local game: '+e.message)}
  finally{O.busy=false}
};
$('btnLocalJoin').onclick=()=>{
  O.nick=$('nickInput').value.trim()||'Player';store.set('chess.nick',O.nick);
  $('localDlgTitle').textContent='Join Local Game';
  $('localDlgHint').textContent='Paste the code from the host player below and press Connect. Then send the reply code back to the host.';
  $('localDlgCode').value='';$('localDlgCode').classList.add('hidden');
  $('localDlgIn').value='';$('localDlgIn').classList.remove('hidden');
  $('localDlgConnect').textContent='Connect';$('localDlgConnect').disabled=false;$('localDlgConnect').classList.remove('hidden');
  $('localConnDlg').classList.remove('hidden');
};
$('localDlgConnect').onclick=async()=>{
  const txt=($('localDlgIn').value||'').trim();
  if(!txt){toast('Paste the code first');return}
  try{
    const data=JSON.parse(txt);
    const sdp=data.sdp||data;
    if(O.rtc&&O.rtc.signalingState==='have-local-offer'){
      /* Host applying the guest's answer (this step was missing entirely before) */
      await O.rtc.setRemoteDescription(sdp);
      for(const c of(data.c||[])){try{await O.rtc.addIceCandidate(c)}catch(e){}}
      toast('Connecting…');
    }else{
      /* Guest applying the host's offer and producing the reply */
      if(!O.rtc){
        const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
        O.rtc=pc;
        pc.ondatachannel=e=>{
          const dc=e.channel;O.dc=dc;
          dc.onmessage=localMsg;
          dc.onopen=()=>{$('localConnDlg').classList.add('hidden');toast('Connected!')};
          dc.onclose=()=>{if(O.mode==='local'){toast('Connection closed');leaveOnline();showScreen('menu')}};
        };
      }
      await O.rtc.setRemoteDescription(sdp);
      for(const c of(data.c||[])){try{await O.rtc.addIceCandidate(c)}catch(e){}}
      const answer=await O.rtc.createAnswer();
      await O.rtc.setLocalDescription(answer);
      const ac=[];
      O.rtc.onicecandidate=e=>{if(e.candidate)ac.push(e.candidate)};
      $('localDlgHint').textContent='Reply code is ready — send it back to the host (Copy).';
      setTimeout(()=>{
        $('localDlgCode').classList.remove('hidden');
        $('localDlgCode').value=JSON.stringify({t:'a',sdp:O.rtc.localDescription,c:ac});
        try{navigator.clipboard.writeText($('localDlgCode').value)}catch(e){}
      },1500);
    }
    $('localDlgConnect').disabled=true;
  }catch(e){toast('Invalid code: '+e.message)}
};
$('localDlgCopy').onclick=()=>{
  const v=$('localDlgCode').classList.contains('hidden')?'':$('localDlgCode').value;
  if(!v){toast('Nothing to copy yet');return}
  try{navigator.clipboard.writeText(v);toast('Copied!')}catch(e){$('localDlgCode').select()}
};
$('localDlgClose').onclick=()=>{$('localConnDlg').classList.add('hidden');$('localDlgConnect').disabled=false};

document.addEventListener('pointerdown',()=>{try{ac()}catch(e){}},{once:true});
$('nickInput').value=O.nick;
applySettingsUI();
demoNew();
sizeDemo();
showScreen('menu');
