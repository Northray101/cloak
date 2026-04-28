/* ════════════════════════════════════════════════════════
   CLOAK SEARCH INTEGRATION PATCH
   Drop this AFTER cloak.js in chat.html.

   Patches:
   1. Overwrites send() to support search tool calls
   2. Adds citation strip renderer
   3. Injects search system prompt
   ════════════════════════════════════════════════════════ */

/* ── SYSTEM PROMPT ADDITION ── */
const SEARCH_SYSTEM_PROMPT = `You have access to web search tools. When a user's question would benefit from current information, real-time data, specific URLs, or facts you're unsure about, use these tools.

SEARCH TOOL SYNTAX — wrap in XML tags in your response:

For a web search:
<search>{"queries":["your query here"],"maxSources":5}</search>

For reading specific URLs:
<search>{"followUrls":["https://example.com/page"]}</search>

For deep crawling (follow to sub-pages):
<search>{"queries":["initial query"],"deepCrawl":["https://specific-page.com/article"]}</search>

You can combine: queries + followUrls + deepCrawl in one <search> block.
You can emit multiple <search> blocks if you need to search different topics.
After your search block(s), end with: <done/>

Then wait — search results will be injected and you will get a second turn to synthesize.
In your synthesis turn, write your full answer. Cite sources inline with [1], [2] etc.

RULES:
- Only use search when genuinely needed (current events, facts, specific data, URLs user mentioned)
- Be specific with queries — "React 19 concurrent features 2024" not "React features"
- If a result page seems to have more info on sub-links, use deepCrawl on those URLs
- You can request up to 3 search rounds if needed
- Always synthesize into a clear, helpful answer after searching`;

/* ── CITATION STRIP RENDERER ── */
function renderCitationStrip(botMsgEl, sources) {
  if (!sources || !sources.length) return;
  const botBody = botMsgEl.querySelector('.bot-body');
  if (!botBody) return;
  const existing = botBody.querySelector('.search-citation-strip');
  if (existing) existing.remove();

  const strip = document.createElement('div');
  strip.className = 'search-citation-strip';

  sources.slice(0, 8).forEach((src, i) => {
    const chip = document.createElement('a');
    chip.className = 'search-cit-chip';
    chip.href = src.url || '#';
    chip.target = '_blank';
    chip.rel = 'noopener noreferrer';
    chip.style.animationDelay = `${i * 60}ms`;
    chip.addEventListener('click', e => { e.preventDefault(); interceptLink(e, src.url); });

    const domain = (() => { try { return new URL(src.url).hostname.replace('www.', ''); } catch { return src.url.slice(0, 20); } })();
    chip.innerHTML = `<span class="cit-chip-num">${i + 1}</span><span class="cit-chip-label">${CLOAK_SEARCH.escHtml(src.title || domain)}</span>`;
    strip.appendChild(chip);
  });

  botBody.appendChild(strip);
}

/* ── SEARCH-AWARE SEND ── */
// We save the original send and replace it
const _originalSend = window.send;

window.send = async function () {
  const inp = document.getElementById('chat-input');
  const txt = inp.value.trim();
  if ((!txt && !attachedImgs.length) || busy) return;
  if (guest && guestN >= GUEST_MAX) { showLimit(); return; }
  checkMentalHealth(txt);
  if (!chatId) { chatId = Date.now().toString(); hist = []; }

  if (voiceMode) { voiceState = 'thinking'; if (recognition) recognition.stop(); }

  const imgs = [...attachedImgs];
  attachedImgs = []; renderImgStrip();

  inp.value = ''; inp.style.height = 'auto';
  setBusy(true);
  addMsg('user', txt, false, imgs);

  const t0 = Date.now();
  const hasImages = imgs.length > 0;
  const model = window.cloakModel || 'pneuma';
  const useThoughts = _shouldThink(model);

  let userMsg = txt;
  if (hwMode && txt) userMsg = '[HOMEWORK MODE]\n\n' + txt;
  if (!userMsg && hasImages) userMsg = '[Image]';
  hist.push({ role: 'USER', message: userMsg });

  stats.req++;
  log('req', `"${(txt || '[image]').slice(0, 60)}" model=${model} search=enabled`);

  showMessages();

  // Build API messages with search system prompt
  const apiMessages = hist.slice(0, -1).map(m => ({
    role: m.role === 'CHATBOT' ? 'assistant' : 'user',
    content: m.message,
  }));
  apiMessages.push({ role: 'user', content: userMsg || '[Image]' });

  let imageBase64 = null, mimeType = null;
  if (hasImages && imgs[0]) {
    const match = imgs[0].data.match(/^data:([^;]+);base64,(.+)$/);
    if (match) { mimeType = match[1]; imageBase64 = match[2]; }
  }

  const trimmedMessages = apiMessages.slice(-20);
  const bodyObj = {
    model,
    messages: trimmedMessages,
    system: SEARCH_SYSTEM_PROMPT,
    imageBase64: imageBase64 || undefined,
    mimeType: mimeType || undefined,
  };

  /* ── ROUND 1: Get model's initial response (may include tool calls) ── */
  _fetchController = new AbortController();
  let botMsgEl = null;

  try {
    const res = await fetch(CLOAK_API + '/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: _fetchController.signal,
      body: JSON.stringify(bodyObj),
    });
    _fetchController = null;

    let d;
    try { d = await res.json(); } catch (_) { throw new Error('Unreadable response.'); }
    if (!res.ok || d.error) throw new Error(d.error || 'HTTP ' + res.status);

    let firstResponse = d.response || d.text || '';
    if (!firstResponse) throw new Error('Empty response.');

    /* ── Check for search tool calls ── */
    if (CLOAK_SEARCH.hasToolCalls(firstResponse)) {
      const toolCalls = CLOAK_SEARCH.parseToolCalls(firstResponse);

      if (toolCalls.length > 0) {
        // Create bot bubble for search UI
        botMsgEl = insertBotBubbleForThoughts();

        // Run thoughts in parallel with search if applicable
        let thoughtsPromise = null;
        if (useThoughts) {
          thoughtsPromise = (async () => {
            createThoughtChain(botMsgEl);
            addThoughtStep('Planning Search', 'Determining what to look up and which sources to target.');
            await sleep(800);
            addThoughtStep('Executing Queries', 'Running web searches and reading relevant pages.');
          })();
        }

        // Execute all search calls
        let allGathered = [];
        for (const call of toolCalls) {
          if (call.type === 'search') {
            const gathered = await CLOAK_SEARCH.search(call.params, botMsgEl);
            allGathered = allGathered.concat(gathered);
          } else if (call.type === 'fetch') {
            // Direct URL fetch
            CLOAK_SEARCH.createSearchBlock(botMsgEl);
            const idx = CLOAK_SEARCH.addSearchResultCard(
              { url: call.params.url, title: call.params.url, snippet: '' }, 'direct'
            );
            CLOAK_SEARCH.updateSourceBadge(idx, 'reading');
            try {
              const content = await CLOAK_SEARCH.extractUrl(call.params.url, { maxChars: call.params.maxChars || 5000 });
              allGathered.push({ url: call.params.url, title: call.params.url, extracted: content });
              CLOAK_SEARCH.updateSourceBadge(idx, 'done');
            } catch (e) {
              CLOAK_SEARCH.updateSourceBadge(idx, 'skip');
            }
          }
        }

        // Finalise thoughts if running
        if (useThoughts) {
          await thoughtsPromise;
          addThoughtStep('Synthesising', 'Combining search results into a coherent answer.');
          await sleep(400);
          finaliseThoughts(botMsgEl);
        }

        CLOAK_SEARCH.updateTicker('Composing answer…');

        // Build context with search results for synthesis
        const searchContext = allGathered
          .filter(s => s.extracted)
          .map((s, i) => `[${i + 1}] ${s.url}\n${s.title}\n${s.extracted.slice(0, 2000)}`)
          .join('\n\n---\n\n');

        const synthesisMessages = [
          ...trimmedMessages,
          { role: 'assistant', content: firstResponse },
          {
            role: 'user',
            content: `Here are the search results:\n\n${searchContext}\n\nNow synthesise a complete, helpful answer. Cite sources inline with [1], [2] etc. matching the source numbers above.`
          }
        ];

        // Round 2: Synthesis
        stats.req++;
        log('req', `Synthesis round | sources=${allGathered.length}`);

        _fetchController = new AbortController();
        const synthRes = await fetch(CLOAK_API + '/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: _fetchController.signal,
          body: JSON.stringify({
            model,
            messages: synthesisMessages.slice(-22),
            system: SEARCH_SYSTEM_PROMPT,
          }),
        });
        _fetchController = null;

        let synthD;
        try { synthD = await synthRes.json(); } catch { throw new Error('Synthesis response unreadable.'); }
        if (!synthRes.ok || synthD.error) throw new Error(synthD.error || 'HTTP ' + synthRes.status);

        const finalText = synthD.response || synthD.text || '';
        if (!finalText) throw new Error('Empty synthesis response.');

        CLOAK_SEARCH.finaliseSearchBlock(botMsgEl);

        // Stream the final answer
        const ms = Date.now() - t0;
        stats.lat.push(ms); stats.res++;
        log('res', `${ms}ms | search+synthesis | len=${finalText.length}`);

        hist.push({ role: 'CHATBOT', message: finalText });
        if (hist.length > 20) hist = hist.slice(-20);

        replaceThinkWithContent(botMsgEl, finalText);

        // Render citation strip after a short delay
        setTimeout(() => {
          renderCitationStrip(botMsgEl, allGathered.filter(s => s.url));
        }, 600);

        if (voiceMode) playVoice(finalText);
        if (guest) { guestN++; if (guestN >= GUEST_MAX) setTimeout(showLimit, 500); }
        else saveConv(txt || '[Image]').catch(e => log('err', 'Save: ' + e.message));

        return; // Done — search path handled
      }
    }

    /* ── No tool calls — normal path ── */
    const ms = Date.now() - t0;
    stats.lat.push(ms); stats.res++;
    log('res', `${ms}ms | no-search | len=${firstResponse.length}`);

    hist.push({ role: 'CHATBOT', message: firstResponse });
    if (hist.length > 20) hist = hist.slice(-20);

    if (useThoughts) {
      botMsgEl = insertBotBubbleForThoughts();
      const responsePromise = Promise.resolve({ responseText: firstResponse });
      await runThoughtSequence(botMsgEl, model, txt || '[Image]', responsePromise);
      replaceThinkWithContent(botMsgEl, firstResponse);
    } else {
      botMsgEl = insertBotBubble();
      const bc = botMsgEl.querySelector('.bot-content');
      if (bc) streamContent(bc, firstResponse, () => { setBusy(false); });
      else setBusy(false);
      return;
    }

    if (voiceMode) playVoice(firstResponse);
    if (guest) { guestN++; if (guestN >= GUEST_MAX) setTimeout(showLimit, 500); }
    else saveConv(txt || '[Image]').catch(e => log('err', 'Save: ' + e.message));

  } catch (ex) {
    _fetchController = null;
    stopThinkAnimation();
    if (ex.name === 'AbortError') {
      if (botMsgEl) botMsgEl.remove();
      else {
        const msgs = document.getElementById('messages');
        if (msgs && msgs.lastChild?.classList?.contains('bot')) msgs.lastChild.remove();
      }
      if (hist.length && hist[hist.length - 1].role === 'USER') hist.pop();
      setBusy(false);
    } else {
      stats.err++;
      log('err', ex.message);
      const errTxt = ex.message.match(/^(HTTP 5|Service|No response|Empty)/i)
        ? 'Service temporarily unavailable — please try again.'
        : CLOAK_SEARCH.escHtml(ex.message);
      if (!botMsgEl) botMsgEl = insertBotBubble();
      replaceThinkWithContent(botMsgEl, 'Error: ' + errTxt);
      if (voiceMode) playVoice('Sorry, I ran into an error.');
    }
  }
};
