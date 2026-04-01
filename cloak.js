const SB_URL='https://kdawsqrrmwirilyhcolk.supabase.co';
const SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkYXdzcXJybXdpcmlseWhjb2xrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjUxNjAsImV4cCI6MjA4OTU0MTE2MH0.cMN9V51J3042DrdaDmL7-ro-AMaw-IU47wQLnW2NMBE';
const ADMIN='weston07052010@gmail.com';
const GUEST_MAX=10;

let sb=null,busy=false,entering=false;
let dark=localStorage.getItem('cloak_dark')!=='0';
let currentTheme=localStorage.getItem('cloak_theme')||'default';
let temp=parseFloat(localStorage.getItem('cloak_temp')||'0.7');
let extraPrompt=localStorage.getItem('cloak_extra_prompt')||'';
let email='',uid='',name='',admin=false;
let guest=false,guestN=0;
let verifyEmail='';
let convs=[],chatId=null,hist=[],logs=[],logF='all',stats={req:0,res:0,err:0,lat:[]},atab='general';
let annId=null;
let hwMode=false, thinkModeActive=false, attachedImgs=[];
let onboardingDone=false;
let _fetchController=null;
let _streamAbort=false;

/* Dynamic Model Variables - Cohere Primary, Gemini Secondary */
let dynamicModels = ['cohere/command-r-plus-08-2024', 'google/gemini-2.5-flash'];
let modelCycleIndex = 0;

/* Voice Mode Variables */
let voiceMode = false;
let voiceState = 'idle'; // idle, listening, thinking, speaking
let asciiInterval = null;
let asciiFrame = 0;
let recognition = null;
let synth = window.speechSynthesis;

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
    const { data, error } = await sb.from('app_config').select('value').eq('key', 'model_list').single();
    if (data && data.value) {
      dynamicModels = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      log('inf', 'Loaded dynamic models: ' + dynamicModels.join(', '));
    }
  } catch(e) { 
    log('err', 'Config load failed, using fallbacks: ' + e.message); 
  }
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
  return '<pre><div class="code-bar"><span class="code-lang">'+hesc(dl)+'<\/span><div class="code-actions"><button class="code-btn" onclick="cpCode(\''+id+'\',this)">Copy<\/button><\/div><\/div><code id="'+id+'">'+hl+'<\/code><\/pre>';
};
rend.link=(href,title,text)=>{
  const safe=hesc(href||'');const t=title?'title="'+hesc(title)+'"':'';
  return '<a href="#" class="ext-link" '+t+' onclick="interceptLink(event,\''+safe+'\')">'+text+'</a>';
};
marked.use({renderer:rend,mangle:false,headerIds:false});

/* ── STREAM ANIMATION ── */
function streamContent(container, rawText, onComplete) {
  _streamAbort=false;
  let pos=0;
  const total=rawText.length;

  function renderPartial(text){
    if(!text){container.innerHTML='<span class="sc"></span>';return;}
    const lastBlock=text.lastIndexOf('\n\n');
    let html;
    if(lastBlock===-1){
      html='<p>'+hesc(text)+'<span class="sc"></span></p>';
    }else{
      const complete=text.slice(0,lastBlock+2);
      const trailing=text.slice(lastBlock+2);
      html=marked.parse(complete);
      if(trailing)html+='<p>'+hesc(trailing)+'<span class="sc"></span></p>';
      else html+='<span class="sc"></span>';
    }
    container.innerHTML=html;
    scrollBottom();
  }

  function tick(){
    if(_streamAbort||pos>=total){
      container.innerHTML=marked.parse(rawText);
      postProcessBotEl(container.closest('.msg'),rawText);
      scrollBottom();
      if(onComplete)onComplete();
      return;
    }

    const prevChar=pos>0?rawText[pos-1]:'';
    let chunk,delay;

    if('.!?'.includes(prevChar)&&rawText[pos]===' '){
      chunk=1;delay=55+Math.random()*75;
    } else if(',;'.includes(prevChar)){
      chunk=1;delay=12+Math.random()*18;
    } else if(prevChar==='\n'){
      chunk=1;delay=25+Math.random()*40;
    } else {
      const r=Math.random();
      if(r<0.08){chunk=1;delay=40+Math.random()*30;}
      else if(r<0.25){chunk=1;delay=12+Math.random()*10;}
      else if(r<0.65){chunk=Math.floor(2+Math.random()*3);delay=8+Math.random()*6;}
      else{chunk=Math.floor(4+Math.random()*6);delay=4+Math.random()*4;}
    }

    pos=Math.min(pos+chunk,total);
    renderPartial(rawText.slice(0,pos));
    setTimeout(tick,delay);
  }
  tick();
}

function stopStream(){
  _streamAbort=true;
  if(_fetchController){_fetchController.abort();_fetchController=null;}
}

/* ── WORD ANIMATION (history replay) ── */
function animWords(el){
  const SKIP=new Set(['CODE','PRE','SCRIPT','STYLE','BUTTON']);let i=0;
  const n=(el.innerText||'').split(/\s+/).filter(Boolean).length;const d=n<60?20:n<150?12:7;
  function walk(node){
    if(node.nodeType===3){const t=node.textContent;if(!t.trim())return;const f=document.createDocumentFragment();
      t.split(/(\s+)/).forEach(p=>{if(/^\s+$/.test(p)||!p){f.appendChild(document.createTextNode(p));return;}
        const s=document.createElement('span');s.className='wa';
        const jitter=Math.random()*8;
        s.style.animationDelay=(i++*d+jitter)+'ms';s.textContent=p;f.appendChild(s);});
      node.parentNode.replaceChild(f,node);
    }else if(node.nodeType===1&&!SKIP.has(node.tagName))Array.from(node.childNodes).forEach(walk);
  }
  walk(el);
}

/* ── POST-PROCESS BOT MESSAGE ── */
function postProcessBotEl(msgEl, rawText){
  if(!msgEl||msgEl.querySelector('.msg-actions'))return;
  const botBody=msgEl.querySelector('.bot-body');if(!botBody)return;
  const actions=document.createElement('div');
  actions.className='msg-actions';
  
  const copyBtn=document.createElement('button');
  copyBtn.className='msg-action-btn';
  copyBtn.title='Copy response';
  copyBtn.innerHTML='<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  copyBtn.addEventListener('click',()=>{
    const txt=rawText||(msgEl.querySelector('.bot-content')?.innerText||'');
    navigator.clipboard.writeText(txt).then(()=>{
      copyBtn.classList.add('copied');
      copyBtn.innerHTML='<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>';
      setTimeout(()=>{copyBtn.classList.remove('copied');copyBtn.innerHTML='<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';},1600);
    }).catch(()=>{});
  });

  actions.appendChild(copyBtn);
  botBody.appendChild(actions);
}

/* ── ADD MESSAGE ── */
function addMsg(role,content,noAnim=false,imgs=[]){
  const box=document.getElementById('messages');
  const d=document.createElement('div');
  d.className='msg '+(role==='user'?'user':'bot');

  if(role==='user'){
    const i=name?name[0].toUpperCase():guest?'G':email?email[0].toUpperCase():'U';
    let imgHtml='';
    if(imgs.length){imgHtml='<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">';imgs.forEach(img=>{imgHtml+='<img src="'+img.data+'" style="width:80px;height:80px;object-fit:cover;border:2px solid var(--ink)" alt="img">';});imgHtml+='</div>';}
    d.innerHTML='<div class="av av-user">'+i+'</div><div class="msg-wrap"><div class="bubble">'+imgHtml+(content?'<div>'+hesc(content)+'</div>':'')+'</div></div>';
    if(content)d.dataset.raw=content;
    const actions=document.createElement('div');
    actions.className='msg-actions user-msg-actions';
    const editBtn=document.createElement('button');
    editBtn.className='msg-action-btn';
    editBtn.title='Edit message';
    editBtn.innerHTML='<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    editBtn.addEventListener('click',()=>editMessage(d));
    actions.appendChild(editBtn);
    const wrap=d.querySelector('.msg-wrap');if(wrap)wrap.appendChild(actions);
  }else{
    const html=noAnim?marked.parse(content):'';
    d.innerHTML='<div class="av av-bot"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L7.4 4.6L11 6L7.4 7.4L6 11L4.6 7.4L1 6L4.6 4.6Z" fill="#fff"/></svg></div><div class="bot-body"><div class="bot-meta"><div class="bot-dot"></div><span class="bot-label">Cloak</span></div><div class="bot-content">'+html+'</div></div>';
    if(noAnim){
      const bc=d.querySelector('.bot-content');
      if(bc)requestAnimationFrame(()=>animWords(bc));
      postProcessBotEl(d,content);
    }
  }
  box.appendChild(d);scrollBottom();return d;
}

function editMessage(msgEl){
  if(busy)return;
  const rawText=msgEl.dataset.raw||'';
  const box=document.getElementById('messages');
  const msgs=Array.from(box.children);
  const idx=msgs.indexOf(msgEl);
  if(idx===-1)return;
  const removed=msgs.slice(idx);
  removed.forEach(el=>el.remove());
  const toRemove=removed.length;
  hist=hist.slice(0,Math.max(0,hist.length-toRemove));
  const inp=document.getElementById('chat-input');
  inp.value=rawText;inp.focus();onInput(inp);
  if(!hist.length){document.getElementById('messages').style.display='none';document.getElementById('empty-state').style.display='flex';}
}

function showMessages(){document.getElementById('empty-state').style.display='none';document.getElementById('messages').style.display='flex';}
function scrollBottom(){const ca=document.getElementById('chat-area');if(ca)ca.scrollTop=ca.scrollHeight;}
function onInput(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,160)+'px';if(!busy)document.getElementById('send-btn').disabled=!el.value.trim();}
function onKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!document.getElementById('send-btn').disabled&&!busy)send();else if(busy){stopStream();}}}
function showE(el,msg){el.textContent=msg;el.classList.add('show');}
function clearE(id){const el=document.getElementById(id);if(el){el.textContent='';el.classList.remove('show');}}

/* ── VOICE MODE ── */
function initVoice() {
  const SpRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpRec) return false;
  
  recognition = new SpRec();
  recognition.continuous = true;
  recognition.interimResults = true;
  
  recognition.onstart = () => { 
    if(voiceMode && voiceState !== 'thinking' && voiceState !== 'speaking') {
      voiceState = 'listening'; 
    }
  };
  
  recognition.onresult = (e) => {
    let interim = ''; let final = '';
    for(let i=e.resultIndex; i<e.results.length; ++i) {
      if(e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    document.getElementById('voice-transcript').textContent = final || interim;
    
    if(final) {
      document.getElementById('chat-input').value = final;
      send(); 
    }
  };
  
  recognition.onend = () => {
    if(voiceMode && voiceState === 'idle') {
      try { recognition.start(); } catch(e){}
    }
  };
  return true;
}

function startVoiceMode() {
  if(!recognition) {
    const supported = initVoice();
    if(!supported) { alert("Voice dictation is not supported in your browser."); return; }
  }
  voiceMode = true;
  voiceState = 'idle';
  document.getElementById('voice-overlay').classList.add('active');
  document.getElementById('voice-transcript').textContent = 'Listening...';
  startAsciiAnim();
  try { recognition.start(); } catch(e){}
}

function stopVoiceMode() {
  voiceMode = false;
  document.getElementById('voice-overlay').classList.remove('active');
  stopAsciiAnim();
  if(recognition) recognition.stop();
  synth.cancel();
}

function startAsciiAnim() {
   if(asciiInterval) clearInterval(asciiInterval);
   asciiInterval = setInterval(() => {
     asciiFrame++;
     let art = "";
     let stat = "";
     
     if(voiceState === 'listening') {
       const frames = ["[ = - - - - - ]", "[ - = - - - - ]", "[ - - = - - - ]", "[ - - - = - - ]", "[ - - - - = - ]", "[ - - - - - = ]", "[ - - - - = - ]", "[ - - - = - - ]", "[ - - = - - - ]", "[ - = - - - - ]"];
       art = frames[asciiFrame % frames.length];
       stat = "Listening";
     } else if(voiceState === 'thinking') {
       const frames = ["[ .           ]", "[ . .         ]", "[ . . .       ]", "[ . . . .     ]", "[ . . . . .   ]", "[ . . . . . . ]", "[   . . . . . ]", "[     . . . . ]", "[       . . . ]", "[         . . ]", "[           . ]", "[             ]"];
       art = frames[asciiFrame % frames.length];
       stat = "Thinking";
     } else if(voiceState === 'speaking') {
       const frames = ["[ | | | | | | ]", "[ / / / / / / ]", "[ - - - - - - ]", "[ \\ \\ \\ \\ \\ \\ ]"];
       art = frames[asciiFrame % frames.length];
       stat = "Speaking";
     } else {
       art = "[ - - - - - - ]";
       stat = "Idle";
     }
     document.getElementById('voice-ascii').textContent = art;
     document.getElementById('voice-status').textContent = stat;
   }, 150);
}

function stopAsciiAnim() { clearInterval(asciiInterval); }

function stripMD(text) {
  return text.replace(/[#*`_~]/g, '').replace(/\[.*?\]\(.*?\)/g, '').trim();
}

function playVoice(text) {
   if(recognition) recognition.stop();
   voiceState = 'speaking';
   const cleanText = stripMD(text);
   const u = new SpeechSynthesisUtterance(cleanText);
   
   u.onend = () => {
      if(!voiceMode) return;
      voiceState = 'idle';
      document.getElementById('voice-transcript').textContent = 'Listening...';
      try { recognition.start(); } catch(e){}
   };
   u.onerror = () => {
      if(!voiceMode) return;
      voiceState = 'idle';
      try { recognition.start(); } catch(e){}
   };
   synth.speak(u);
}

function renderConvs(){
  const list=document.getElementById('conv-list');list.innerHTML='';
  convs.forEach(c=>{
    const d=document.createElement('div');d.className='conv-item'+(c.id===chatId?' active':'');
    const lbl=document.createElement('div');lbl.className='conv-label';lbl.textContent=c.title;lbl.title=c.title;lbl.onclick=()=>loadConv(c.id);
    const del=document.createElement('button');del.className='conv-del';del.title='Delete';
    del.innerHTML='<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
    del.onclick=e=>{e.stopPropagation();delConv(c.id);};d.appendChild(lbl);d.appendChild(del);list.appendChild(d);
  });
}
function newChat(){
  chatId=null;hist=[];document.getElementById('messages').innerHTML='';
  document.getElementById('messages').style.display='none';document.getElementById('empty-state').style.display='flex';renderConvs();
}
function cpCode(id,btn){navigator.clipboard.writeText(document.getElementById(id)?.innerText||'').then(()=>{btn.textContent='Copied!';btn.classList.add('ok');setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('ok');},1400);});}

/* ── BUSY STATE / TYPING BUBBLE ── */
function setBusy(b){
  busy=b;
  const btn=document.getElementById('send-btn');
  const inp=document.getElementById('chat-input');
  if(b){
    btn.disabled=false;btn.classList.add('stop-mode');
    btn.innerHTML='<svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor"><rect x="1" y="1" width="9" height="9" rx="1.5"/></svg>';
    btn.onclick=stopStream;btn.title='Stop';
  }else{
    btn.classList.remove('stop-mode');
    btn.innerHTML='<svg width="15" height="15" fill="currentColor" viewBox="0 0 24 24"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/></svg>';
    btn.onclick=send;btn.title='Send';
    btn.disabled=!inp.value.trim();
  }
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function insertTypingBubble() {
  const box = document.getElementById('messages');
  showMessages();
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.innerHTML = '<div class="av av-bot"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L7.4 4.6L11 6L7.4 7.4L6 11L4.6 7.4L1 6L4.6 4.6Z" fill="#fff"/></svg></div><div class="bot-body"><div class="bot-meta"><div class="bot-dot"></div><span class="bot-label">Cloak</span></div><div class="bot-content"><div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div></div>';
  box.appendChild(wrap);
  scrollBottom();
  return wrap;
}

function replaceThinkWithContent(thinkEl, rawText) {
  let postTyping = thinkEl.querySelector('.think-post-typing');
  if (postTyping) {
    const finalContent = document.createElement('div');
    finalContent.className = 'bot-content-final';
    postTyping.parentNode.replaceChild(finalContent, postTyping);
    streamContent(finalContent, rawText, () => { setBusy(false); });
  } else {
    let bc = thinkEl.querySelector('.bot-content');
    if (bc) {
      bc.innerHTML = '';
      streamContent(bc, rawText, () => { setBusy(false); });
    }
  }
  scrollBottom();
}

/* ── PLUS MENU / MODES / IMAGE ── */
function togglePlusMenu(e){e.stopPropagation();document.getElementById('plus-menu').classList.toggle('open');}

function toggleHwMode(){
  hwMode=!hwMode;
  const hm = document.getElementById('menu-homework');
  if (hm) hm.classList.toggle('active-mode', hwMode);
  const hl = document.getElementById('hw-label');
  if (hl) hl.classList.toggle('show', hwMode);
  const pb = document.getElementById('plus-btn');
  if (pb) pb.classList.toggle('has-mode', hwMode||thinkModeActive||attachedImgs.length>0);
  const pm = document.getElementById('plus-menu');
  if (pm) pm.classList.remove('open');
}

function toggleThinkMode() {
  thinkModeActive = !thinkModeActive;
  const mt = document.getElementById('menu-think');
  if (mt) mt.classList.toggle('active-mode', thinkModeActive);
  const tl = document.getElementById('think-label');
  if (tl) tl.classList.toggle('show', thinkModeActive);
  const pb = document.getElementById('plus-btn');
  if (pb) pb.classList.toggle('has-mode', hwMode||thinkModeActive||attachedImgs.length>0);
  const pm = document.getElementById('plus-menu');
  if (pm) pm.classList.remove('open');
}

function onImgPick(inp){Array.from(inp.files).forEach(f=>{const r=new FileReader();r.onload=ev=>{attachedImgs.push({name:f.name,data:ev.target.result});renderImgStrip();};r.readAsDataURL(f);});inp.value='';}
function onPaste(e){const items=Array.from(e.clipboardData?.items||[]);const imageItems=items.filter(i=>i.type.startsWith('image/'));if(!imageItems.length)return;e.preventDefault();imageItems.forEach(item=>{const f=item.getAsFile();if(!f)return;const r=new FileReader();r.onload=ev=>{attachedImgs.push({name:'pasted.png',data:ev.target.result});renderImgStrip();};r.readAsDataURL(f);});}
function renderImgStrip(){
  const strip=document.getElementById('img-strip');strip.innerHTML='';
  if(attachedImgs.length){strip.classList.add('show');attachedImgs.forEach((img,i)=>{const w=document.createElement('div');w.className='img-thumb-wrap';w.innerHTML='<img class="img-thumb" src="'+img.data+'" alt="img"><button class="img-thumb-del" onclick="removeImg('+i+')">&times;</button>';strip.appendChild(w);});}
  else strip.classList.remove('show');
  const pb = document.getElementById('plus-btn');
  if(pb) pb.classList.toggle('has-mode',hwMode||thinkModeActive||attachedImgs.length>0);
}
function removeImg(i){attachedImgs.splice(i,1);renderImgStrip();}

/* ── REMOVED UI CLICKS ── */
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
function handleAdAgree(){localStorage.setItem('cloak_ad_consent','yes');document.getElementById('ad-modal').style.display='none';loadAdSense();}
function handleAdDisagree(){_adDisagreeClicks++;const btn=document.getElementById('ad-disagree-btn');if(_adDisagreeClicks===1){btn.textContent='Are you sure?';btn.style.borderColor='var(--acc)';btn.style.color='var(--acc)';btn.style.fontWeight='800';}else{localStorage.setItem('cloak_ad_consent','no');document.getElementById('ad-modal').style.display='none';}}

/* ── LINK INTERCEPT ── */
let _pendingLink='';
function interceptLink(e,href){e.preventDefault();e.stopPropagation();if(!href||href==='#')return;_pendingLink=href;document.getElementById('link-url-display').textContent=href;document.getElementById('link-go-btn').onclick=()=>{window.open(_pendingLink,'_blank','noopener,noreferrer');closeLinkModal();};document.getElementById('link-modal').style.display='flex';}
function closeLinkModal(){document.getElementById('link-modal').style.display='none';_pendingLink='';}
document.addEventListener('DOMContentLoaded',()=>{const lm=document.getElementById('link-modal');if(lm)lm.addEventListener('click',function(e){if(e.target===this)closeLinkModal();});});

/* ── VALUES PAGE ── */
function showValues(){window.location.href='values.html';}
function hideValues(){window.location.href='index.html';}

/* ── INIT ── */
async function init(){
  sb=supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage}});
  await loadAppConfig();
  if(window.location.hash&&window.location.hash.includes('access_token'))window.history.replaceState(null,'',window.location.pathname);
  initThemeUI();
  let _routed=false;
  sb.auth.onAuthStateChange(async(ev,sess)=>{
    if(ev==='INITIAL_SESSION'){if(_routed)return;_routed=true;if(sess?.user){email=sess.user.email||'';uid=sess.user.id;guest=false;await enterChat();}else{hideLoading();show('auth');}}
    else if(ev==='SIGNED_IN'&&sess&&!_routed){_routed=true;email=sess.user.email||'';uid=sess.user.id;guest=false;await enterChat();}
    else if(ev==='SIGNED_OUT'){_routed=false;entering=false;convs=[];chatId=null;hist=[];admin=false;name='';guest=false;show('auth');}
    else if(ev==='TOKEN_REFRESHED'&&sess){email=sess.user.email||'';uid=sess.user.id;}
  });
  setTimeout(async()=>{if(_routed)return;try{const{data:{session}}=await sb.auth.getSession();if(_routed)return;_routed=true;if(session?.user){email=session.user.email||'';uid=session.user.id;guest=false;await enterChat();}else{hideLoading();show('auth');}}catch(e){_routed=true;hideLoading();show('auth');}},800);
}

function hideLoading(){var el=document.getElementById('s-loading');if(!el)return;el.classList.add('hidden');setTimeout(()=>{el.style.display='none';},220);}

async function enterChat(){
  if(entering)return;entering=true;
  try{
    await whenDomReady();
    hideLoading();
    document.querySelectorAll('.screen').forEach(el=>{el.classList.remove('active');el.style.display='';});
    const valuesEl=document.getElementById('s-values');if(valuesEl)valuesEl.style.display='none';
    const chatEl=document.getElementById('s-chat');if(!chatEl)return;
    chatEl.classList.add('active');
    if(window._vv)window._vv();
    if(!guest)name=name||email.split('@')[0];
    refreshUI();updateGreeting();
    if(!guest)Promise.all([loadProfile(),loadConvs(),loadAnn()]).catch(()=>{});
    else{try{document.getElementById('guest-note').style.display='block';}catch(e){}log('inf','Guest mode');}
  }finally{entering=false;}
}

function startGuest(){guest=true;guestN=0;name='';email='';uid='';entering=false;hideLoading();enterChat();}
function updateGreeting(){const el=document.getElementById('empty-greeting');if(el)el.textContent=name?'Hey, '+name+'!':'Hey there!';}

/* ── AUTH ── */
let signingIn=true;
function authMode(m){signingIn=m==='in';document.getElementById('tab-in').classList.toggle('active',signingIn);document.getElementById('tab-up').classList.toggle('active',!signingIn);document.getElementById('field-name').style.display=signingIn?'none':'block';document.getElementById('field-confirm').style.display=signingIn?'none':'block';document.getElementById('btn-submit').textContent=signingIn?'Sign in':'Create account';clearE('auth-err');}
function authKey(e,nextId,isPass=false){if(e.key==='Enter'){e.preventDefault();if(isPass&&signingIn){handleAuth();return;}if(nextId){const next=document.getElementById(nextId);if(next&&next.offsetParent!==null){next.focus();return;}}handleAuth();}}
async function handleAuth(){
  const em=document.getElementById('inp-email').value.trim();const pw=document.getElementById('inp-pass').value;
  const err=document.getElementById('auth-err');const btn=document.getElementById('btn-submit');
  if(!em||!pw){showE(err,'Please fill in all fields.');return;}
  btn.disabled=true;
  if(signingIn){
    btn.textContent='Signing in\u2026';
    const{data:d,error:e}=await sb.auth.signInWithPassword({email:em,password:pw});
    if(e){showE(err,e.message);}else if(d?.session){email=d.session.user.email||'';uid=d.session.user.id;guest=false;await enterChat();return;}
  }else{
    const nm=document.getElementById('inp-name').value.trim();const cf=document.getElementById('inp-confirm').value;
    btn.textContent='Creating\u2026';
    if(pw!==cf){showE(err,'Passwords do not match.');btn.disabled=false;btn.textContent='Create account';return;}
    if(pw.length<8){showE(err,'Password must be at least 8 characters.');btn.disabled=false;btn.textContent='Create account';return;}
    const{error:e}=await sb.auth.signUp({email:em,password:pw,options:{data:{display_name:nm||em.split('@')[0]}}});
    if(e){showE(err,e.message);}else{verifyEmail=em;document.getElementById('verify-addr').textContent=em;show('verify');return;}
  }
  btn.disabled=false;btn.textContent=signingIn?'Sign in':'Create account';
}
async function resendVerify(){if(!verifyEmail)return;await sb.auth.resend({type:'signup',email:verifyEmail});}
async function handleMfa(){
  const code=document.getElementById('mfa-code').value.trim();const err=document.getElementById('mfa-err');
  if(code.length<6){showE(err,'Enter the 6-digit code.');return;}
  try{const{data:f}=await sb.auth.mfa.listFactors();const t=f?.totp?.[0];if(!t){showE(err,'No authenticator registered.');return;}const{data:ch}=await sb.auth.mfa.challenge({factorId:t.id});const{error:e}=await sb.auth.mfa.verify({factorId:t.id,challengeId:ch.id,code});if(e){showE(err,e.message);return;}enterChat();}catch(ex){showE(err,ex.message);}
}
async function doLogout(){await sb.auth.signOut();closeModal('modal-settings');}

/* ── PROFILE ── */
async function loadProfile(){
  try{
    const{data}=await sb.from('profiles').select('*').eq('id',uid).single();
    if(data){name=data.display_name||email.split('@')[0];admin=data.is_admin||email===ADMIN;onboardingDone=data.onboarding_done||false;}
    else{name=email.split('@')[0];admin=email===ADMIN;onboardingDone=false;await sb.from('profiles').upsert({id:uid,display_name:name,is_admin:admin,onboarding_done:false},{onConflict:'id'});}
    if(admin){document.getElementById('snav-admin').style.display='flex';loadAdminAnns();}
    refreshUI();updateGreeting();if(!onboardingDone)showOnboarding();
  }catch(e){log('err','Profile load: '+e.message);}
}
async function saveName(){
  const n=document.getElementById('s-name-inp').value.trim();if(!n)return;
  name=n;if(!guest){const{error}=await sb.from('profiles').upsert({id:uid,display_name:n},{onConflict:'id'});if(error)log('err','Name save: '+error.message);else log('inf','Name saved: '+n);}
  refreshUI();updateGreeting();const b=document.querySelector('#spane-general .cta');if(b){b.textContent='Saved';setTimeout(()=>b.textContent='Save',1800);}
}

/* ── ANNOUNCEMENTS ── */
async function loadAnn(){
  try{const{data}=await sb.from('announcements').select('*').eq('active',true).order('created_at',{ascending:false}).limit(1);if(!data?.length)return;const a=data[0];if(localStorage.getItem('cloak_ann')===a.id)return;annId=a.id;document.getElementById('ann-msg').textContent=a.message;document.getElementById('ann-bar').classList.add('show');const sbAnn=document.getElementById('sb-ann-bar');const sbAnnMsg=document.getElementById('sb-ann-msg');if(sbAnn&&sbAnnMsg){sbAnnMsg.textContent=a.message;sbAnn.style.display='block';}}catch(e){}
}
function dismissAnn(){if(annId)localStorage.setItem('cloak_ann',annId);document.getElementById('ann-bar').classList.remove('show');const sbAnn=document.getElementById('sb-ann-bar');if(sbAnn)sbAnn.style.display='none';}
async function postAnn(){const m=document.getElementById('ann-compose').value.trim();if(!m)return;const{error}=await sb.from('announcements').insert({message:m,created_by:uid});if(!error){document.getElementById('ann-compose').value='';loadAnn();loadAdminAnns();log('inf','Announcement posted');}else log('err','Post failed: '+error.message);}
async function loadAdminAnns(){const{data}=await sb.from('announcements').select('*').order('created_at',{ascending:false});const el=document.getElementById('admin-ann-list');if(!el)return;if(!data?.length){el.innerHTML='<div style="font-size:13px;opacity:.55">None active.</div>';return;}el.innerHTML=data.map(a=>'<div class="ann-row"><div class="ann-row-msg">'+hesc(a.message)+(a.active?'':' <span style="opacity:.4;font-size:10px">(inactive)</span>')+'<\/div><button class="ann-deact" onclick="deactAnn(\''+a.id+'\')">Delete<\/button><\/div>').join('');}
async function deactAnn(id){await sb.from('announcements').delete().eq('id',id);if(annId===id){annId=null;document.getElementById('ann-bar').classList.remove('show');const sbAnn=document.getElementById('sb-ann-bar');if(sbAnn)sbAnn.style.display='none';localStorage.removeItem('cloak_ann');}loadAdminAnns();}

/* ── GUEST LIMIT ── */
function showLimit(){if(document.getElementById('limit-modal'))return;const d=document.createElement('div');d.id='limit-modal';d.className='limit-overlay';d.innerHTML='<div class="limit-card"><div class="limit-title">You\'re loving Cloak!</div><div class="limit-body">You\'ve used your '+GUEST_MAX+' guest messages.<br>Create a free account to keep going.</div><button class="btn-primary" onclick="goSignUp()">Create free account</button><br><button class="limit-skip" onclick="dismissLimit()">Maybe later</button></div>';document.body.appendChild(d);}
function goSignUp(){const d=document.getElementById('limit-modal');if(d)d.remove();show('auth');authMode('up');}
function dismissLimit(){const d=document.getElementById('limit-modal');if(d)d.remove();}

/* ── UI HELPERS ── */
function show(id){hideLoading();document.querySelectorAll('.screen').forEach(el=>{el.classList.remove('active');el.style.display='';});const chatEl=document.getElementById('s-chat');if(chatEl)chatEl.classList.remove('active');const valuesEl=document.getElementById('s-values');if(valuesEl)valuesEl.style.display='none';var el=document.getElementById('s-'+id);if(!el)return;el.classList.add('active');if(id!=='chat')el.style.display='flex';}
function refreshUI(){
  const i=name?name[0].toUpperCase():email?email[0].toUpperCase():'G';
  ['sb-av','s-av'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=i;});
  document.getElementById('sb-name').textContent=guest?'Guest':(name||email.split('@')[0]);
  document.getElementById('sb-email').textContent=guest?'Not signed in':email;
  document.getElementById('s-name').textContent=guest?'Guest':(name||'—');
  document.getElementById('s-email').textContent=guest?'Not signed in':email;
  document.querySelectorAll('.moon').forEach(el=>el.style.display=dark?'none':'block');
  document.querySelectorAll('.sun').forEach(el=>el.style.display=dark?'block':'none');
}
function toggleDark(){dark=!dark;document.body.classList.toggle('dark',dark);document.documentElement.classList.toggle('dark',dark);localStorage.setItem('cloak_dark',dark?'1':'0');const ml=document.getElementById('mode-label');if(ml)ml.textContent=dark?'dark':'light';refreshUI();}
function toggleSidebar(){const el=document.getElementById('sidebar');const mobile=window.innerWidth<=640;if(mobile){const open=!el.classList.contains('collapsed');if(open){el.classList.add('collapsed');document.getElementById('sb-overlay').classList.remove('show');}else{el.classList.remove('collapsed');document.getElementById('sb-overlay').classList.add('show');}}else el.classList.toggle('collapsed');}
function closeMobileSidebar(){document.getElementById('sidebar').classList.add('collapsed');document.getElementById('sb-overlay').classList.remove('show');}

/* ── SETTINGS ── */
function openSettings(){
  if(guest){show('auth');return;}
  
  const sysPrompt = document.getElementById('sys-prompt');
  if(sysPrompt) sysPrompt.value = extraPrompt;
  
  const tempSlider = document.getElementById('temp-slider');
  if(tempSlider) tempSlider.value = Math.round(temp*10);
  
  const tempVal = document.getElementById('temp-val');
  if(tempVal) tempVal.textContent = temp.toFixed(1);
  
  document.getElementById('s-name-inp').value=name;
  document.getElementById('mode-label').textContent=dark?'dark':'light';
  document.getElementById('modal-settings').style.display='flex';
  initThemeUI();
  if(admin)loadAdminAnns();
  updateStats();
  renderLogs();
}
function closeModal(id){const el=document.getElementById(id);el.classList.add('hiding');setTimeout(()=>{el.style.display='none';el.classList.remove('hiding');},120);}
function overlayClick(e,id){if(e.target===document.getElementById(id))closeModal(id);}
function switchSettingsTab(t){atab=t;document.querySelectorAll('.snav-btn').forEach(el=>el.classList.toggle('on',el.id==='snav-'+t));document.querySelectorAll('.spane').forEach(el=>el.classList.remove('on'));const p=document.getElementById('spane-'+t);if(p)p.classList.add('on');if(t==='console'){updateStats();renderLogs();}}
function saveModel(){
  const sysPrompt = document.getElementById('sys-prompt');
  const tempSlider = document.getElementById('temp-slider');
  if(sysPrompt) extraPrompt=sysPrompt.value.trim();
  if(tempSlider) temp=parseFloat(tempSlider.value)/10;
  localStorage.setItem('cloak_extra_prompt',extraPrompt);
  localStorage.setItem('cloak_temp',String(temp));
  const b=document.querySelector('#spane-model .cta');
  if(b){b.textContent='Saved';setTimeout(()=>b.textContent='Save model settings',1800);}
}
async function clearAllChats(){if(!confirm('Delete ALL conversations?'))return;const{error}=await sb.from('chats').delete().eq('user_id',uid);if(error)log('err','Clear failed: '+error.message);else{convs=[];newChat();log('inf','All chats deleted');}}

/* ── 2FA ── */
async function start2FA(){try{const{data,error}=await sb.auth.mfa.enroll({factorType:'totp'});if(error)throw error;const sec=document.getElementById('totp-section');sec.style.display='block';document.getElementById('totp-secret').textContent='Secret: '+data.totp.secret;document.getElementById('totp-qr').innerHTML='<img src="'+data.totp.qr_code+'" style="width:160px;height:160px;border:var(--bd)" />';window._totpFactorId=data.id;}catch(e){alert('2FA setup failed: '+e.message);}}
async function confirmTOTP(){const code=document.getElementById('totp-code').value.trim();const err=document.getElementById('totp-err');if(!code){showE(err,'Enter code');return;}try{const{data:ch}=await sb.auth.mfa.challenge({factorId:window._totpFactorId});const{error}=await sb.auth.mfa.verify({factorId:window._totpFactorId,challengeId:ch.id,code});if(error){showE(err,error.message);return;}document.getElementById('totp-section').style.display='none';alert('2FA enabled!');}catch(e){showE(err,e.message);}}

/* ── CONSOLE ── */
function log(type,msg){const n=new Date();const ts=n.toLocaleTimeString('en-US',{hour12:false})+'.'+String(n.getMilliseconds()).padStart(3,'0');logs.push({type,msg,ts});if(logs.length>500)logs.shift();if(document.getElementById('modal-settings')?.style.display!=='none'&&atab==='console'){renderLogs();updateStats();}}
function renderLogs(){const box=document.getElementById('console-log');const fl=logF==='all'?logs:logs.filter(l=>l.type===logF);if(!fl.length){box.innerHTML='<div class="log-empty">No logs yet</div>';return;}box.innerHTML=fl.map(l=>'<div class="log-row"><span class="log-ts">'+l.ts+'</span><span class="log-badge b-'+l.type+'">'+l.type+'</span><div class="log-msg">'+hesc(l.msg)+'</div></div>').join('');box.scrollTop=box.scrollHeight;}
function updateStats(){document.getElementById('st-req').textContent=stats.req;document.getElementById('st-res').textContent=stats.res;document.getElementById('st-err').textContent=stats.err;const avg=stats.lat.length?Math.round(stats.lat.reduce((a,b)=>a+b,0)/stats.lat.length):null;document.getElementById('st-lat').textContent=avg?avg+'ms':'—';}
function setFilter(f,el){logF=f;document.querySelectorAll('.filter-pill').forEach(b=>b.classList.remove('on'));el.classList.add('on');renderLogs();}
function clearLogs(){logs=[];stats={req:0,res:0,err:0,lat:[]};renderLogs();updateStats();}

/* ── STORAGE ── */
async function loadConvs(){const{data,error}=await sb.from('chats').select('id,title,updated_at').eq('user_id',uid).order('updated_at',{ascending:false});if(error){log('err','Load convs: '+error.message);return;}convs=(data||[]).map(r=>({id:r.id,title:r.title}));renderConvs();log('inf','Loaded '+convs.length+' chat(s)');}
async function loadConv(id){const{data,error}=await sb.from('chats').select('*').eq('id',id).single();if(error){log('err','Load chat: '+error.message);return;}chatId=id;hist=data.messages||[];document.getElementById('messages').innerHTML='';hist.forEach(m=>addMsg(m.role==='CHATBOT'?'bot':'user',m.message,true));showMessages();renderConvs();}
async function saveConv(first){if(!uid||guest)return;let currentUid=uid;try{const{data:{session}}=await sb.auth.getSession();if(!session?.user){log('err','Save aborted: no session');return;}currentUid=session.user.id;uid=currentUid;}catch(e){log('err','Save: session check failed');return;}const ex=convs.find(c=>c.id===chatId);const title=ex?ex.title:(first.slice(0,50)+(first.length>50?'\u2026':''));if(!ex)convs.unshift({id:chatId,title});renderConvs();const{error}=await sb.from('chats').upsert({id:chatId,user_id:currentUid,title,messages:hist,updated_at:new Date().toISOString()},{onConflict:'user_id,id'});if(error){log('err','Save: '+error.message);}else{log('inf','Chat saved: '+title.slice(0,30));}}
async function delConv(id){const{error}=await sb.from('chats').delete().eq('id',id).eq('user_id',uid);if(error){log('err','Delete: '+error.message);return;}convs=convs.filter(c=>c.id!==id);if(chatId===id)newChat();else renderConvs();}

/* ── SEND ── */
async function send(){
  const inp=document.getElementById('chat-input');const txt=inp.value.trim();
  if((!txt&&!attachedImgs.length)||busy)return;
  if(guest&&guestN>=GUEST_MAX){showLimit();return;}
  if(!chatId){chatId=Date.now().toString();hist=[];}
  
  if(voiceMode) {
     voiceState = 'thinking';
     if(recognition) recognition.stop();
  }

  const imgs=[...attachedImgs];attachedImgs=[];renderImgStrip();
  let userMsg=txt;
  inp.value='';inp.style.height='auto';
  setBusy(true);
  addMsg('user',txt,false,imgs);
  const t0=Date.now();

  let currentModel = dynamicModels.length > 0 ? dynamicModels[modelCycleIndex] : 'cohere/command-r-plus-08-2024';
  if (dynamicModels.length > 0) { modelCycleIndex = (modelCycleIndex + 1) % dynamicModels.length; }

  stats.req++;log('req',`"${(txt||'[image]').slice(0,60)}" model=${currentModel} guest=${guest} hwMode=${hwMode} thinkMode=${thinkModeActive} imgs=${imgs.length}`);
  
  const thinkEl = insertTypingBubble();

  try{
    let ocrText='',ocrFailed=false;
    if(imgs.length&&typeof Tesseract!=='undefined'){
      try{
        const results=await Promise.all(imgs.map(img=>Tesseract.recognize(img.data,'eng',{logger:()=>{}}).then(r=>{const conf=r.data.confidence;const raw=r.data.text.trim();if(conf<60||raw.length<4)return '';return raw.split('\n').map(l=>l.trim()).filter(l=>l.length>1&&!/^[^a-zA-Z0-9]{1,3}$/.test(l)).join('\n');}).catch(()=>'')));
        ocrText=results.filter(Boolean).join('\n\n');if(!ocrText)ocrFailed=true;
      }catch(e){ocrFailed=true;}
    }
    if(imgs.length&&ocrFailed&&!ocrText&&!txt){
      replaceThinkWithContent(thinkEl,'The image could not be read clearly. OCR works best with printed or typed text.');
      hist.push({role:'CHATBOT',message:'The image could not be read clearly. OCR works best with printed or typed text.'});
      setBusy(false);
      if(voiceMode) playVoice('The image could not be read clearly.');
      return;
    }
    if(hwMode){let pt=txt;if(ocrText)pt=(txt?txt+'\n\n':'')+'Problem from image:\n"""\n'+ocrText+'\n"""';else if(!txt&&imgs.length)pt='(Image attached but text could not be extracted.)';userMsg='[HOMEWORK MODE]\n\n'+(pt||'(no problem provided)');}
    else if(ocrText){userMsg=(txt?txt+'\n\n':'What does this say or show?\n\n')+'Text from image:\n"""\n'+ocrText+'\n"""';}
    else if(imgs.length&&ocrFailed&&txt){userMsg=txt+' (An image was attached but could not be read.)';}

    // -- THINK MODE PRE-REQUEST --
    if(thinkModeActive) {
      try {
         let preBodyObj = {
            message: "Analyze the following request and provide a 3-step thinking process outline. Outline how you will approach reasoning and use tools. Return STRICTLY a JSON array of 3 short strings. Request: " + userMsg,
            model: currentModel,
            chat_history: hist.slice(0,-1).map(m=>({role:m.role,message:m.message})),
            temperature: 0.2
         };
         if(guest) preBodyObj.guest = true;
         
         let preHdrs={'Content-Type':'application/json'};
         if(!guest) {
            try {
               const {data:{session}} = await sb.auth.getSession();
               if(session?.access_token) preHdrs['Authorization']='Bearer '+session.access_token;
            } catch(e){}
         }

         const outlineRes = await fetch(SB_URL+'/functions/v1/chat-message',{
            method:'POST', headers:preHdrs, body:JSON.stringify(preBodyObj)
         });

         if(outlineRes.ok) {
            const outData = await outlineRes.json();
            let text = outData.text.replace(/```json/g, '').replace(/```/g, '').trim();
            let steps = ["Analyzing request", "Formulating strategy", "Drafting response"];
            try {
               let parsed = JSON.parse(text);
               if(Array.isArray(parsed) && parsed.length > 0) steps = parsed.slice(0, 3);
            } catch(e){}

            const botContent = thinkEl.querySelector('.bot-content');
            botContent.innerHTML = `
              <details class="think-dropdown" open>
                <summary class="think-summary"><span class="think-title">Thinking...</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></summary>
                <div class="think-steps" id="think-steps-container"></div>
              </details>
              <div class="think-post-typing"><div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>
            `;
            const stepsContainer = botContent.querySelector('#think-steps-container');
            for (let i = 0; i < steps.length; i++) {
                await sleep(600 + Math.random() * 800);
                const stepEl = document.createElement('div');
                stepEl.className = 'think-step-item';
                stepEl.innerHTML = `<span class="think-step-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span><span style="flex:1">${hesc(steps[i])}</span>`;
                stepsContainer.appendChild(stepEl);
                scrollBottom();
            }
            await sleep(600);
            const thinkTitle = botContent.querySelector('.think-title');
            if (thinkTitle) thinkTitle.textContent = "Thought process complete";
            const dropdown = botContent.querySelector('.think-dropdown');
            if (dropdown) dropdown.removeAttribute('open');
         }
      } catch(e) {
         console.error("Think mode pre-request failed", e);
      }
    }

    hist.push({role:'USER',message:userMsg||(imgs.length?'[Image]':'')});

    // -- ACTUAL REQUEST --
    let hdrs={'Content-Type':'application/json'};
    let bodyObj={
      message: userMsg,
      model: currentModel,
      chat_history: hist.slice(0,-1).map(m=>({role:m.role,message:m.message})),
      temperature: temp,
      think_mode: thinkModeActive // <--- TELLS BACKEND TO TRIGGER WEB SEARCH
    };

    if(guest){
      bodyObj.guest=true;
      log('inf','send: guest mode');
    }else{
      try{
        const{data:{session}}=await sb.auth.getSession();
        if(session?.access_token){
          hdrs['Authorization']='Bearer '+session.access_token;
          log('inf',`send: authed uid=${session.user?.id?.slice(0,8)} exp=${new Date((session.expires_at||0)*1000).toISOString()}`);
        }else{
          log('err','send: getSession() returned no token');
        }
      }catch(ex){
        log('err','send: getSession() threw — '+ex.message);
      }
    }

    _fetchController=new AbortController();
    const res=await fetch(SB_URL+'/functions/v1/chat-message',{
      method:'POST',
      headers:hdrs,
      signal:_fetchController.signal,
      body:JSON.stringify(bodyObj)
    });
    _fetchController=null;

    let d;try{d=await res.json();}catch(_){throw new Error('Bad response from server');}
    const ms=Date.now()-t0;
    if(!res.ok||d.error)throw new Error(d.error||'HTTP '+res.status);
    stats.lat.push(ms);stats.res++;log('res',`${ms}ms | model=${currentModel} | replyLen=${d.text?.length??0} | uid=${d.userId??'?'}`);
    hist.push({role:'CHATBOT',message:d.text});
    if(hist.length>20)hist=hist.slice(-20);

    replaceThinkWithContent(thinkEl, d.text);
    
    if(voiceMode) playVoice(d.text);

    if(guest){guestN++;if(guestN>=GUEST_MAX)setTimeout(showLimit,500);}
    else saveConv(txt||'[Image]').catch(e=>log('err','Save: '+e.message));
  }catch(ex){
    _fetchController=null;
    if(ex.name==='AbortError'){
      thinkEl.remove();
      if(!hist.length||hist[hist.length-1].role!=='CHATBOT'){
        if(hist.length&&hist[hist.length-1].role==='USER')hist.pop();
      }
    }else{
      stats.err++;
      log('err',`${ex.message} | model=${currentModel} | guest=${guest}`);
      replaceThinkWithContent(thinkEl,'Error: '+hesc(ex.message));
      if(voiceMode) playVoice("Sorry, I ran into an error.");
    }
    setBusy(false);
  }
}

(function(){const sb=document.getElementById('sidebar');if(window.innerWidth<=640&&sb)sb.classList.add('collapsed');})();
whenDomReady().then(()=>{checkAdConsent();init();});
