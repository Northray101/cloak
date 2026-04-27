const SB_URL='https://wpjefllmqwpiuqlyfcyz.supabase.co';
const SB_KEY='YOUR_SUPABASE_ANON_KEY';
const sb=supabase.createClient(SB_URL,SB_KEY);

const CLOAK_API='https://cloak-api.onrender.com';

let uid=null,email=null,role='user',guest=false;
let currentModel='pneuma';
let hist=[];
let currentTheme=localStorage.getItem('cloak_theme')||'paper';
let dark=currentTheme==='dark';

let stats={req:0,res:0,lat:[],err:0};
let voiceMode=false, thinkModeActive=false, attachedImgs=[];
let hwMode=false, onboardingDone=false;
let _fetchController=null, _streamAbort=false;
let _thinkTimer=null, _thinkPhaseIdx=0;

/* ── STEP SYSTEM STATE ── */
let _stepListEl = null;
let _stepEls = [];
let _stepLog = [];
let _stepCollapseBtn = null;
let _stepListInner = null;
let _stepCollapsed = false;

/* ── STEP SCRIPTS for each model tier ── */
const THOUGHT_SCRIPTS = {
  default: [
    { title:'Reading your message',  body:'Parsing intent, scope, and any implicit constraints in your phrasing.' },
    { title:'Gathering context',     body:'Cross-referencing the conversation history and pulling in relevant knowledge.' },
    { title:'Planning the response', body:'Choosing the right format, depth, and tone for this specific request.' },
    { title:'Writing',               body:'Composing the reply and refining structure, wording, and clarity as I go.' },
  ],
  reasoning: [
    { title:'Breaking down the problem', body:'Identifying the core question and all sub-problems that need to be resolved first.' },
    { title:'Exploring approaches',      body:'Weighing multiple strategies and comparing trade-offs before committing.' },
    { title:'Stress-testing',            body:'Looking for edge cases, contradictions, and weak spots in the reasoning chain.' },
    { title:'Building the answer',       body:'Integrating the strongest approach into a coherent, well-reasoned response.' },
    { title:'Final review',              body:'Checking accuracy, completeness, and clarity before sending.' },
  ],
  creative: [
    { title:'Setting the tone',   body:'Calibrating voice, register, and style for the moment.' },
    { title:'Finding the angle',  body:'Looking for the framing that makes the response feel original and alive.' },
    { title:'Building structure', body:'Laying out flow, pacing, and where the strongest beats should land.' },
    { title:'Writing',            body:'Generating the actual content with rhythm, specificity, and variation.' },
    { title:'Polishing',          body:'Tightening language, trimming weak phrases, and sharpening the final result.' },
  ],
};

function _thoughtScriptFor(model) {
  if(model==='logos') return 'reasoning';
  if(model==='kairos') return 'creative';
  return 'default';
}

function _shouldThink(model) {
  return model==='logos' || model==='kairos' || thinkModeActive;
}

const THOUGHT_DELAY_MS = {
  logos:  [1200, 2400, 3800, 5400, 7200],
  kairos: [1000, 2200, 3600, 5200, 7000],
  pneuma: [800, 1800, 3000, 4400, 6000],
};

/* Voice Mode Variables */
let voiceState='idle';
let asciiInterval=null;
let asciiFrame=0;
let recognition=null;
let synth=window.speechSynthesis;

if(dark)document.body.classList.add('dark');

let _domReady=document.readyState!=='loading';
function whenDomReady(){
  if(_domReady)return Promise.resolve();
  return new Promise(resolve=>{
    document.addEventListener('DOMContentLoaded',()=>{_domReady=true;resolve();},{once:true});
  });
}

/* ── CONFIG ── */
async function loadAppConfig() {
  try {
    const { data } = await sb.from('app_config').select('value').eq('key', 'model_list').single();
    if (data && data.value) log('inf', 'Config loaded');
  } catch(e) { log('err', 'Config load failed: ' + e.message); }
}

/* ── THEME ── */
function setTheme(t){
  currentTheme=t;localStorage.setItem('cloak_theme',t);
  document.documentElement.setAttribute('data-theme',t);
  document.querySelectorAll('.theme-card').forEach(el=>el.classList.toggle('active',el.id==='theme-'+t));
}
function initThemeUI(){document.querySelectorAll('.theme-card').forEach(el=>el.classList.toggle('active',el.id==='theme-'+currentTheme));}

/* ── VIEWPORT FIX ── */
(function(){
  function applyVV(){var el=document.getElementById('s-chat');if(!el||!el.classList.contains('active'))return;var vv=window.visualViewport;if(vv){el.style.top=vv.offsetTop+'px';el.style.left=vv.offsetLeft+'px';el.style.width=vv.width+'px';el.style.height=vv.height+'px';}else{el.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0';}}
  if(window.visualViewport){window.visualViewport.addEventListener('resize',applyVV);window.visualViewport.addEventListener('scroll',applyVV);}
  window.addEventListener('resize',applyVV);window._vv=applyVV;
})();

/* ── MARKED / SYNTAX ── */
function hesc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function syntaxHL(code,lang){
  var out=hesc(code);
  var kw={js:['const','let','var','function','return','if','else','for','while','do','switch','case','break','continue','new','delete','typeof','instanceof','in','of','import','export','default','class','extends','super','this','async','await','try','catch','finally','throw','from','null','undefined','true','false','void'],py:['def','class','return','if','elif','else','for','while','import','from','as','with','try','except','finally','raise','and','or','not','in','is','None','True','False','lambda','pass','break','continue','yield','async','await'],sql:['SELECT','FROM','WHERE','JOIN','LEFT','RIGHT','INNER','ON','GROUP','ORDER','BY','HAVING','INSERT','UPDATE','DELETE','CREATE','ALTER','DROP','TABLE','VALUES','SET','AS','AND','OR','NOT','IN','LIKE','BETWEEN','NULL','IS','COUNT','SUM','AVG','MAX','MIN','DISTINCT']};
  var l={js:kw.js,javascript:kw.js,ts:kw.js,typescript:kw.js,py:kw.py,python:kw.py,sql:kw.sql}[lang];
  out=out.replace(/(&#x27;[^&#x27;]*&#x27;|&quot;[^&quot;]*&quot;)/g,'<span class="str">$1</span>');
  out=out.replace(/(\/\/[^\n]*)/g,'<span class="cmt">$1</span>');
  out=out.replace(/(#[^\n]*)/g,'<span class="cmt">$1</span>');
  out=out.replace(/\b(\d+\.?\d*)\b/g,'<span class="num">$1</span>');
  if(l)l.forEach(function(k){out=out.replace(new RegExp('\\b('+k+')\\b','g'),'<span class="kw">$1</span>');});
  return out;
}
const rend=new marked.Renderer();
rend.code=(code,lang)=>{
  const dl=lang||'text';const id='c'+Math.random().toString(36).slice(2,8);const hl=syntaxHL(code,lang);
  return '<pre><div class="code-bar"><span class="code-lang">'+hesc(dl)+'</span><div class="code-actions"><button class="code-btn" onclick="cpCode(\''+id+'\',this)">Copy</button></div></div><code id="'+id+'">'+hl+'</code></pre>';
};
rend.link=(href,title,text)=>{
  const safe=hesc(href||'');const t=title?'title="'+hesc(title)+'"':'';
  if (/^\[?\d+\]?$/.test(text)) {
    const num = text.replace(/[\[\]]/g, '');
    return '<a href="#" class="cit-bubble" '+t+' onclick="interceptLink(event,\''+safe+'\')">'+num+'</a>';
  }
  return '<a href="#" class="ext-link" '+t+' onclick="interceptLink(event,\''+safe+'\')">'+text+'</a>';
};
marked.use({renderer:rend,mangle:false,headerIds:false});

/* ════════════════════════════════════════════════════════
   STEP SYSTEM v5 — Claude-style visible step list
   Each step is a row: spinner→check icon, title, body.
   Steps are revealed one at a time as the model thinks.
   ════════════════════════════════════════════════════════ */

function createThoughtChain(botMsgEl) {
  const botBody = botMsgEl.querySelector('.bot-body');
  if(!botBody) return null;

  const existing = botBody.querySelector('.step-list-wrap');
  if(existing) existing.remove();

  _stepLog = [];
  _stepEls = [];
  _stepCollapsed = false;

  const wrap = document.createElement('div');
  wrap.className = 'step-list-wrap';

  const header = document.createElement('div');
  header.className = 'step-list-header';

  const headerLeft = document.createElement('div');
  headerLeft.className = 'step-list-header-left';

  const headerDot = document.createElement('span');
  headerDot.className = 'step-header-dot';
  headerLeft.appendChild(headerDot);

  const headerLabel = document.createElement('span');
  headerLabel.className = 'step-header-label';
  headerLabel.textContent = 'Thinking…';
  headerLeft.appendChild(headerLabel);

  header.appendChild(headerLeft);

  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'step-collapse-btn';
  collapseBtn.title = 'Collapse';
  collapseBtn.innerHTML = `<svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M9 1L5 5L1 1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  collapseBtn.addEventListener('click', () => toggleStepCollapse(wrap, collapseBtn));
  header.appendChild(collapseBtn);

  wrap.appendChild(header);

  const inner = document.createElement('div');
  inner.className = 'step-list-inner';
  wrap.appendChild(inner);

  botBody.insertBefore(wrap, botBody.querySelector('.bot-content'));

  _stepListEl = wrap;
  _stepListInner = inner;
  _stepCollapseBtn = collapseBtn;

  const botDot = botMsgEl.querySelector('.bot-dot');
  if(botDot) botDot.classList.add('thinking');

  return wrap;
}

function toggleStepCollapse(wrapEl, btnEl) {
  _stepCollapsed = !_stepCollapsed;
  const inner = wrapEl.querySelector('.step-list-inner');
  if(inner) inner.classList.toggle('collapsed', _stepCollapsed);
  btnEl.classList.toggle('rotated', _stepCollapsed);
  btnEl.title = _stepCollapsed ? 'Expand' : 'Collapse';
}

function pushThought(title, body) {
  _stepLog.push({ title, body });
  if(!_stepListInner) return;

  const prev = _stepEls[_stepEls.length - 1];
  if(prev) _markStepDone(prev);

  const row = document.createElement('div');
  row.className = 'step-row step-row-entering';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'step-icon';
  iconWrap.innerHTML = _spinnerSVG();

  const textWrap = document.createElement('div');
  textWrap.className = 'step-text';

  const titleEl = document.createElement('div');
  titleEl.className = 'step-title step-title-active';
  titleEl.textContent = title;

  const bodyEl = document.createElement('div');
  bodyEl.className = 'step-body';
  bodyEl.textContent = body;

  textWrap.appendChild(titleEl);
  textWrap.appendChild(bodyEl);
  row.appendChild(iconWrap);
  row.appendChild(textWrap);
  _stepListInner.appendChild(row);

  requestAnimationFrame(() => {
    row.classList.remove('step-row-entering');
    row.classList.add('step-row-visible');
  });

  _stepEls.push({ rowEl: row, iconEl: iconWrap, titleEl, bodyEl });
  scrollBottom();
}

function _markStepDone(stepObj) {
  if(!stepObj) return;
  stepObj.iconEl.innerHTML = _checkSVG();
  stepObj.iconEl.classList.add('step-icon-done');
  stepObj.titleEl.classList.remove('step-title-active');
  stepObj.titleEl.classList.add('step-title-done');
  stepObj.bodyEl.classList.add('step-body-done');
}

function _spinnerSVG() {
  return `<svg class="step-spinner" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" stroke-opacity="0.2"/><path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

function _checkSVG() {
  return `<svg class="step-check" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 7L6.2 8.8L9.5 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function endThoughts(botMsgEl) {
  const botDot = botMsgEl.querySelector('.bot-dot');
  if(botDot) botDot.classList.remove('thinking');

  const last = _stepEls[_stepEls.length - 1];
  if(last) _markStepDone(last);

  const headerLabel = _stepListEl && _stepListEl.querySelector('.step-header-label');
  if(headerLabel) {
    const n = _stepLog.length;
    headerLabel.textContent = `Thought for ${n} step${n === 1 ? '' : 's'}`;
  }

  const headerDot = _stepListEl && _stepListEl.querySelector('.step-header-dot');
  if(headerDot) headerDot.classList.add('step-header-dot-done');

  if(_stepListEl && _stepListInner && !_stepCollapsed) {
    setTimeout(() => {
      _stepCollapsed = true;
      _stepListInner.classList.add('collapsed');
      if(_stepCollapseBtn) {
        _stepCollapseBtn.classList.add('rotated');
        _stepCollapseBtn.title = 'Expand';
      }
    }, 320);
  }
}

function transitionToResponse(botMsgEl) {
  endThoughts(botMsgEl);
}

async function runThoughtSequence(botMsgEl, model, responsePromise) {
  const script = THOUGHT_SCRIPTS[_thoughtScriptFor(model)];
  const delays = THOUGHT_DELAYS(model, script.length);

  createThoughtChain(botMsgEl);

  let responseReady = false;
  responsePromise.then(() => { responseReady = true; });

  for(let i = 0; i < script.length; i++) {
    const t = script[i];
    pushThought(t.title, t.body);

    const delay = delays[i] || delays[delays.length - 1];
    await Promise.race([
      sleep(delay),
      new Promise(r => {
        const check = setInterval(() => {
          if(responseReady) { clearInterval(check); r(); }
        }, 80);
      })
    ]);

    if(responseReady) break;
  }
}

function THOUGHT_DELAYS(model, count) {
  const base = THOUGHT_DELAY_MS[model] || THOUGHT_DELAY_MS.pneuma;
  const out = [];
  for(let i = 0; i < count; i++) out.push(base[i] || base[base.length - 1] || 1800);
  return out;
}

function toggleThought() {}
function markThoughtDone() {}
function setThoughtTrace() {}

/* ════════════════════════════════════════
   STREAM CONTENT
   ════════════════════════════════════════ */
function streamContent(container, rawText, onComplete) {
  _streamAbort=false;
  let pos=0;
  const total=rawText.length;

  container.classList.add('bot-content-final');
  container.innerHTML='';

  const tick=()=>{
    if(_streamAbort){if(onComplete)onComplete();return;}
    let chunk=rawText.slice(0,pos);
    container.innerHTML=marked.parse(chunk)+'<span class="sc"></span>';
    interceptCitations(container);
    pos+=Math.max(1,Math.ceil((total-pos)/45));
    scrollBottom();
    if(pos<=total)setTimeout(tick,13);
    else{
      container.innerHTML=marked.parse(rawText);
      interceptCitations(container);
      addBotActions(container.closest('.msg.bot'));
      if(onComplete)onComplete();
    }
  };
  tick();
}

function stopStream(){
  _streamAbort=true;
  if(_fetchController){try{_fetchController.abort();}catch(_){ } _fetchController=null;}
  setBusy(false);
}

/* ── UTIL / LOG ── */
function log(t,m){console.log('[CLOAK]',t,m);}
function avg(a){return a.length?(a.reduce((x,y)=>x+y,0)/a.length):0;}
function dateFmt(s){try{return new Date(s).toLocaleString();}catch{return'—';}}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function autoGrow(el){
  el.style.height='auto';
  el.style.height=Math.min(220,el.scrollHeight)+'px';
}
function scrollBottom(){
  const wrap=document.getElementById('messages-wrap');
  wrap.scrollTop=wrap.scrollHeight+200;
}
function showMessages(){
  document.getElementById('hero-state').style.display='none';
  document.getElementById('messages-wrap').classList.add('show');
}
function updateSendState(){
  const inp=document.getElementById('chat-input');
  const btn=document.getElementById('send-btn');
  if(btn.classList.contains('stop-mode'))return;
  btn.disabled=!inp.value.trim()&&!attachedImgs.length;
}
function setBusy(on){
  const btn=document.getElementById('send-btn');
  if(on){
    btn.classList.add('stop-mode');
    btn.innerHTML='<svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor"><rect x="1" y="1" width="9" height="9" rx="1.5"/></svg>';
    btn.onclick=stopStream;btn.title='Stop';
  }else{
    btn.classList.remove('stop-mode');
    btn.innerHTML='<svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/></svg>';
    btn.onclick=send;btn.title='Send';
    btn.disabled=!document.getElementById('chat-input').value.trim()&&!attachedImgs.length;
  }
}

/* ── THINKING BUBBLES ── */
function insertThinkingBubble() {
  const box = document.getElementById('messages');
  showMessages();
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.innerHTML = '<div class="bot-body"><div class="bot-meta"><div class="bot-dot"></div><span class="bot-label">Cloak</span></div><div class="bot-content"><div style="display:flex;align-items:center;gap:7px;height:32px"><div class="dot"></div><div class="dot" style="animation-delay:.16s"></div><div class="dot" style="background:var(--acc);animation-delay:.32s"></div></div></div></div>';
  box.appendChild(wrap);
  scrollBottom();
  return wrap;
}

function insertThinkingBubbleWithThoughts(model) {
  const box = document.getElementById('messages');
  showMessages();
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.innerHTML = '<div class="bot-body"><div class="bot-meta"><div class="bot-dot"></div><span class="bot-label">Cloak</span></div><div class="bot-content"></div></div>';
  box.appendChild(wrap);
  scrollBottom();
  return wrap;
}

function stopThinkAnimation() {
  // no-op — step system manages its own lifecycle
}

function replaceThinkWithContent(thinkEl, rawText) {
  transitionToResponse(thinkEl);
  let bc = thinkEl.querySelector('.bot-content');
  if(bc) {
    bc.innerHTML = '';
    streamContent(bc, rawText, () => { setBusy(false); });
  }
  scrollBottom();
}

/* ── PLUS MENU / MODES / IMAGE ── */
function togglePlusMenu(e){e.stopPropagation();document.getElementById('plus-menu').classList.toggle('open');}

function toggleHwMode(){
  hwMode=!hwMode;
  const hm=document.getElementById('menu-homework');if(hm)hm.classList.toggle('active-mode',hwMode);
  const hl=document.getElementById('hw-label');if(hl)hl.classList.toggle('show',hwMode);
  const pb=document.getElementById('plus-btn');if(pb)pb.classList.toggle('has-mode',hwMode||thinkModeActive||attachedImgs.length>0);
  const pm=document.getElementById('plus-menu');if(pm)pm.classList.remove('open');
}

function toggleThinkMode() {
  thinkModeActive=!thinkModeActive;
  const mt=document.getElementById('menu-think');if(mt)mt.classList.toggle('active-mode',thinkModeActive);
  const tl=document.getElementById('think-label');if(tl)tl.classList.toggle('show',thinkModeActive);
  const pb=document.getElementById('plus-btn');if(pb)pb.classList.toggle('has-mode',hwMode||thinkModeActive||attachedImgs.length>0);
  const pm=document.getElementById('plus-menu');if(pm)pm.classList.remove('open');
}

function onImgPick(inp){Array.from(inp.files).forEach(f=>{const r=new FileReader();r.onload=ev=>{attachedImgs.push({name:f.name,data:ev.target.result});renderImgStrip();};r.readAsDataURL(f);});inp.value='';}
function onPaste(e){const items=Array.from(e.clipboardData?.items||[]);const imageItems=items.filter(i=>i.type.startsWith('image/'));if(!imageItems.length)return;e.preventDefault();imageItems.forEach(item=>{const f=item.getAsFile();if(!f)return;const r=new FileReader();r.onload=ev=>{attachedImgs.push({name:'pasted.png',data:ev.target.result});renderImgStrip();};r.readAsDataURL(f);});}
function renderImgStrip(){
  const strip=document.getElementById('img-strip');strip.innerHTML='';
  if(attachedImgs.length){
    strip.classList.add('show');
    attachedImgs.forEach((img,i)=>{
      const w=document.createElement('div');w.className='img-thumb-wrap';
      w.innerHTML='<img class="img-thumb" src="'+img.data+'" alt="img"><button class="img-thumb-del" onclick="removeImg('+i+')">&times;</button>';
      strip.appendChild(w);
    });
  } else strip.classList.remove('show');
  const pb=document.getElementById('plus-btn');
  if(pb)pb.classList.toggle('has-mode',hwMode||thinkModeActive||attachedImgs.length>0);
}
function removeImg(i){attachedImgs.splice(i,1);renderImgStrip();}

document.addEventListener('click',()=>{document.getElementById('plus-menu')?.classList.remove('open');});

/* ── ONBOARDING ── */
let _onboardChecked=false;
function showOnboarding(){document.getElementById('onboard-modal').style.display='flex';}
function toggleOnboardCheck(){_onboardChecked=!_onboardChecked;document.getElementById('onboard-checkbox').classList.toggle('checked',_onboardChecked);const btn=document.getElementById('onboard-btn');btn.disabled=!_onboardChecked;btn.style.opacity=_onboardChecked?'1':'0.35';btn.style.cursor=_onboardChecked?'pointer':'not-allowed';}
async function confirmOnboarding(){document.getElementById('onboard-modal').style.display='none';onboardingDone=true;if(uid)await sb.from('profiles').update({onboarding_done:true}).eq('id',uid);}

/* ── AD CONSENT ── */
let _adDisagreeClicks=0;
function checkAdConsent(){const c=localStorage.getItem('cloak_ad_consent');if(c==='yes')loadAdSense();else if(!c)document.getElementById('ad-modal').style.display='flex';}
function loadAdSense(){if(document.getElementById('adsense-script'))return;const s=document.createElement('script');s.id='adsense-script';s.async=true;s.src='https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6774734854152622';s.crossOrigin='anonymous';document.head.appendChild(s);}
function acceptAds(){localStorage.setItem('cloak_ad_consent','yes');document.getElementById('ad-modal').style.display='none';loadAdSense();}
function declineAds(){_adDisagreeClicks++;localStorage.setItem('cloak_ad_consent','no');document.getElementById('ad-modal').style.display='none';}

/* ── AUTH / PROFILE ── */
async function bootstrap(){
  setTheme(currentTheme);initThemeUI();
  await loadAppConfig();

  try{
    const {data:{session}}=await sb.auth.getSession();
    if(session?.user){
      uid=session.user.id;
      email=session.user.email;
      guest=false;
      const {data:p}=await sb.from('profiles').select('*').eq('id',uid).single();
      if(p){
        role=p.role||'user';
        onboardingDone=!!p.onboarding_done;
        document.getElementById('profile-role').textContent=role;
        document.getElementById('profile-created').textContent=dateFmt(p.created_at);
      }
      document.getElementById('profile-email').textContent=email||'—';
      document.getElementById('profile-plan').textContent=role==='admin'?'Admin':'Free';
      document.getElementById('plan-label').textContent=role==='admin'?'Admin':'Free';
      if(role==='admin')document.getElementById('admin-link').style.display='block';
      if(!onboardingDone)showOnboarding();
      checkAdConsent();
    }else{
      guest=true;
      role='guest';
      document.getElementById('profile-role').textContent='Guest';
      document.getElementById('profile-email').textContent='Not signed in';
      document.getElementById('profile-plan').textContent='Guest';
      document.getElementById('plan-label').textContent='Guest';
    }
  }catch(e){log('err',e.message);}
  renderRecent();
}
async function logout(){try{await sb.auth.signOut();location.href='./index.html';}catch(_){location.href='./index.html';}}
function openProfile(){document.getElementById('profile-modal').style.display='flex';}
function closeProfile(){document.getElementById('profile-modal').style.display='none';}

/* ── MODEL PICKER ── */
function pickModel(m){
  currentModel=m;
  document.querySelectorAll('[data-model]').forEach(el=>el.classList.toggle('active',el.getAttribute('data-model')===m));
}

/* ── SETTINGS / SIDEBAR ── */
function openSettings(){const el=document.getElementById('settings-sheet');el.classList.add('open');el.setAttribute('aria-hidden','false');}
function closeSettings(){const el=document.getElementById('settings-sheet');el.classList.remove('open');el.setAttribute('aria-hidden','true');}
function toggleSidebar(force){
  const sb=document.getElementById('chat-sidebar');
  const ov=document.getElementById('sb-overlay');
  const open=typeof force==='boolean'?force:!sb.classList.contains('open');
  sb.classList.toggle('open',open);ov.classList.toggle('show',open);
}

/* ── HERO / RECENTS ── */
function newChat(){
  hist=[];
  document.getElementById('messages').innerHTML='';
  document.getElementById('hero-state').style.display='block';
  document.getElementById('messages-wrap').classList.remove('show');
  document.getElementById('chat-input').value='';
  autoGrow(document.getElementById('chat-input'));
  updateSendState();
}
function resetChat(){newChat();closeProfile();}
function renderRecent(){
  const list=document.getElementById('recent-list');
  const rows=JSON.parse(localStorage.getItem('cloak_recent_chats')||'[]');
  list.innerHTML='';
  rows.slice(0,12).forEach(r=>{
    const b=document.createElement('button');
    b.className='recent-item';
    b.innerHTML='<span class="recent-title">'+hesc(r.t||'Untitled')+'</span><span class="recent-time">'+hesc(r.d||'')+'</span>';
    b.onclick=()=>loadRecent(r.id);
    list.appendChild(b);
  });
}
function saveRecent(title){
  const rows=JSON.parse(localStorage.getItem('cloak_recent_chats')||'[]');
  const id='r'+Date.now();
  rows.unshift({id,t:title||'New chat',d:new Date().toLocaleDateString(),hist});
  localStorage.setItem('cloak_recent_chats',JSON.stringify(rows.slice(0,20)));
  renderRecent();
}
function loadRecent(id){
  const rows=JSON.parse(localStorage.getItem('cloak_recent_chats')||'[]');
  const hit=rows.find(x=>x.id===id);
  if(!hit)return;
  hist=hit.hist||[];
  const box=document.getElementById('messages');box.innerHTML='';
  hist.forEach(item=>{
    if(item.role==='USER')insertUser(item.message||'',false);
    else if(item.role==='CHATBOT')insertBotFinal(item.message||'');
  });
  showMessages();
  scrollBottom();
}

/* ── MESSAGE INSERTS ── */
function interceptCitations(root){
  root.querySelectorAll('a.cit-bubble,a.ext-link').forEach(a=>{
    if(a.dataset.bound)return;
    a.dataset.bound='1';
  });
}
function interceptLink(e,url){
  e.preventDefault();
  window.open(url,'_blank','noopener');
}
function insertUser(text,save=true){
  const box=document.getElementById('messages');
  showMessages();
  const wrap=document.createElement('div');
  wrap.className='msg user';
  wrap.innerHTML='<div class="msg-wrap"><div class="user-bubble">'+marked.parseInline(hesc(text).replace(/\n/g,'<br>'))+'</div><div class="user-msg-actions"><button class="mini-copy" onclick="copyText(this,\''+hesc(text).replace(/'/g,"\\'")+'\')">Copy</button></div></div>';
  box.appendChild(wrap);
  if(save)hist.push({role:'USER',message:text});
  if(save&&hist.filter(x=>x.role==='USER').length===1)saveRecent(text.slice(0,54));
  scrollBottom();
}
function insertBotFinal(text){
  const box=document.getElementById('messages');
  showMessages();
  const wrap=document.createElement('div');
  wrap.className='msg bot';
  wrap.innerHTML='<div class="bot-body"><div class="bot-meta"><div class="bot-dot"></div><span class="bot-label">Cloak</span></div><div class="bot-content-final"></div></div>';
  box.appendChild(wrap);
  const bc=wrap.querySelector('.bot-content-final');
  bc.innerHTML=marked.parse(text);
  interceptCitations(bc);
  addBotActions(wrap);
  scrollBottom();
}
function addBotActions(botEl){
  if(!botEl||botEl.querySelector('.msg-actions'))return;
  const bc=botEl.querySelector('.bot-content-final,.bot-content');
  const txt=(bc?.innerText||'').trim();
  const bar=document.createElement('div');
  bar.className='msg-actions';
  bar.innerHTML='<button class="mini-copy" onclick="copyText(this,\''+hesc(txt).replace(/'/g,"\\'")+'\')">Copy</button>';
  botEl.appendChild(bar);
}
function copyText(btn,txt){
  navigator.clipboard.writeText(txt||'').then(()=>{
    const old=btn.textContent;btn.textContent='Copied';setTimeout(()=>btn.textContent=old,900);
  });
}
function cpCode(id,btn){
  const el=document.getElementById(id);if(!el)return;
  navigator.clipboard.writeText(el.innerText||'').then(()=>{btn.classList.add('ok');btn.textContent='Copied';setTimeout(()=>{btn.classList.remove('ok');btn.textContent='Copy';},1000);});
}

/* ── KEYBOARD ── */
function keySend(e){
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
}
document.getElementById('settings-btn')?.addEventListener('click',openSettings);
document.getElementById('theme-toggle')?.addEventListener('click',()=>setTheme(currentTheme==='dark'?'paper':'dark'));

/* ── SAFETY / CRISIS ── */
const MH_PATTERNS=/\b(suicide|suicidal|kill myself|end my life|want to die|self[- ]?harm|cut myself|overdose|no reason to live|don't want to be here|can't go on|hopeless|worthless|crisis)\b/i;
function crisisMessage(){
  return `I'm really sorry you're dealing with that. If you might act on these feelings, call or text 988 now (US/Canada), or contact local emergency services. If you're elsewhere, tell me your country and I’ll give the right crisis line. If you can, move away from anything you could use to hurt yourself and message or call one trusted person right now.`;
}

/* ── VOICE MODE ── */
function toggleVoiceMode(){
  voiceMode=!voiceMode;
  const shell=document.getElementById('voice-shell');
  const btn=document.getElementById('voice-mode-btn');
  if(voiceMode){
    shell.style.display='grid';
    btn.textContent='Disable voice mode';
    voiceState='listening';
    startVoiceLoop();
    initRecognition();
  }else{
    shell.style.display='none';
    btn.textContent='Enable voice mode';
    voiceState='idle';
    stopVoiceLoop();
    if(recognition)try{recognition.stop();}catch(_){}
    synth.cancel();
  }
}
function startVoiceLoop(){
  if(asciiInterval)return;
  asciiInterval=setInterval(renderVoiceAscii,90);
}
function stopVoiceLoop(){clearInterval(asciiInterval);asciiInterval=null;}
function renderVoiceAscii(){
  const el=document.getElementById('voice-ascii');if(!el)return;
  const frames=[
`   .-.
  (   )
   `+'`'+`-'
`,
`  .---.
 (  . .)
  `+'`'+`---'
`,
`  .-*-.
 (  *  )
  `+'`'+`-*-'
`];
  let art=frames[0], stat='Idle';
  if(voiceState==='listening'){
    art=frames[asciiFrame%frames.length]; stat='Listening';
  }else if(voiceState==='thinking'){
    art=frames[(asciiFrame+1)%frames.length]; stat='Thinking';
  }else if(voiceState==='speaking'){
    art=frames[(asciiFrame+2)%frames.length]; stat='Speaking';
  }
  asciiFrame++;
  el.textContent=art;
  document.getElementById('voice-state').textContent=stat;
}
function initRecognition(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR)return;
  recognition=new SR();
  recognition.lang='en-US';
  recognition.interimResults=false;
  recognition.continuous=true;
  recognition.onresult=(e)=>{
    const t=Array.from(e.results).slice(-1)[0][0].transcript;
    if(!t)return;
    document.getElementById('chat-input').value=t;
    autoGrow(document.getElementById('chat-input'));
    send();
  };
  recognition.onend=()=>{if(voiceMode&&voiceState!=='thinking'&&voiceState!=='speaking')try{recognition.start();}catch(_){}};
  try{recognition.start();}catch(_){}
}
function speak(text){
  if(!voiceMode||!window.speechSynthesis)return;
  synth.cancel();
  const u=new SpeechSynthesisUtterance(text.replace(/\[[^\]]+\]/g,''));
  u.onstart=()=>voiceState='speaking';
  u.onend=()=>{voiceState='listening';if(recognition)try{recognition.start();}catch(_){}}; 
  synth.speak(u);
}

/* ════════════════════════════════════════════
   SEND
   ════════════════════════════════════════════ */
async function send(){
  const inp=document.getElementById('chat-input');
  let txt=(inp.value||'').trim();
  const imgs=[...attachedImgs];
  const hasImages=!!imgs.length;
  if(!txt&&!hasImages)return;

  if(MH_PATTERNS.test(txt)){
    insertUser(txt,true);
    insertBotFinal(crisisMessage());
    hist.push({role:'CHATBOT',message:crisisMessage()});
    inp.value='';attachedImgs=[];renderImgStrip();autoGrow(inp);updateSendState();
    return;
  }

  setBusy(true);
  if(voiceMode){voiceState='thinking';if(recognition)recognition.stop();}

  const t0=Date.now();
  const model=currentModel;
  let userMsg=txt;
  if(hwMode&&userMsg)userMsg='[HOMEWORK MODE]\\n'+userMsg;
  if(!userMsg&&hasImages)userMsg='[Image]';

  insertUser(txt||'[Image]',true);
  inp.value='';attachedImgs=[];renderImgStrip();autoGrow(inp);updateSendState();

  hist.push({role:'USER',message:userMsg});

  const useThoughts=_shouldThink(model);
  stats.req++;
  log('req',`"${(txt||'[image]').slice(0,60)}" model=${model} guest=${guest} hwMode=${hwMode} thinkMode=${thinkModeActive} imgs=${imgs.length} thoughts=${useThoughts}`);

  showMessages();
  const botMsgEl = useThoughts ? insertThinkingBubbleWithThoughts(model) : insertThinkingBubble();

  const apiMessages = hist.slice(0,-1).map(m=>({
    role: m.role==='CHATBOT'?'assistant':'user',
    content: m.message,
  }));
  apiMessages.push({role:'user', content:userMsg||'[Image]'});

  let imageBase64=null, mimeType=null;
  if(hasImages && imgs[0]){
    const match=imgs[0].data.match(/^data:([^;]+);base64,(.+)$/);
    if(match){mimeType=match[1];imageBase64=match[2];}
  }

  const trimmedMessages=apiMessages.slice(-20);
  const bodyObj={model,messages:trimmedMessages,imageBase64:imageBase64||undefined,mimeType:mimeType||undefined};

  log('inf',`→ ${CLOAK_API}/v1/chat model=${model} turns=${trimmedMessages.length} thoughts=${useThoughts}`);

  _fetchController=new AbortController();
  let _responseResolve, _responseReject;
  const responsePromise=new Promise((res,rej)=>{_responseResolve=res;_responseReject=rej;});

  const fetchAndResolve = async () => {
    try {
      const res=await fetch(CLOAK_API+'/v1/chat',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        signal:_fetchController.signal,
        body:JSON.stringify(bodyObj),
      });
      _fetchController=null;
      let d;
      try{d=await res.json();}catch(_){throw new Error('Server returned an unreadable response.');}
      if(!res.ok||d.error)throw new Error(d.error||'HTTP '+res.status);
      const responseText=d.response||d.text||'';
      if(!responseText)throw new Error('Empty response from server.');
      _responseResolve({responseText, ms: Date.now()-t0, model: d.model||model});
    } catch(ex) {
      _responseReject(ex);
    }
  };

  fetchAndResolve();

  try {
    if(useThoughts) {
      await runThoughtSequence(botMsgEl, model, responsePromise);
    }

    const {responseText, ms, model: respModel} = await responsePromise;

    stats.lat.push(ms);
    stats.res++;
    log('res',`${respModel} ${ms}ms`);

    hist.push({role:'CHATBOT',message:responseText});
    replaceThinkWithContent(botMsgEl, responseText);

    if(voiceMode) speak(responseText);
  } catch(ex) {
    stats.err++;
    stopThinkAnimation();
    setBusy(false);
    const errTxt=ex?.name==='AbortError'?'Stopped':(ex.message||'Unknown error');
    hist.push({role:'CHATBOT',message:'Error: '+errTxt});
    replaceThinkWithContent(botMsgEl,'Error: '+errTxt);
    if(voiceMode) voiceState='listening';
  }
}

/* ── INIT ── */
window.addEventListener('DOMContentLoaded',async()=>{
  await bootstrap();
  const inp=document.getElementById('chat-input');
  autoGrow(inp);updateSendState();
});
