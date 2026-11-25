// Megai AI server — no npm packages needed (Node 18+)
// Run:  OPENAI_API_KEY=xxxx node server.js     (or GEMINI_API_KEY=xxxx)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/* ---------- STEP 1: fixed templates. The AI only writes the project-specific part. ---------- */
const PHASER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/phaser/3.80.1/phaser.min.js';

const REPORTER = `<script>
(function(){function r(m){try{parent.postMessage({megaiErr:String(m).slice(0,400)},'*')}catch(_){}}
window.addEventListener('error',function(e){r(e.message||'Unknown error')});
window.addEventListener('unhandledrejection',function(e){r((e.reason&&e.reason.message)||e.reason||'Promise error')});})();
</script>`;

const HELPERS = `<script>
window.sfx=(function(){var ctx=null;function c(){if(!ctx){var A=window.AudioContext||window.webkitAudioContext;if(A)ctx=new A()}if(ctx&&ctx.state==='suspended')ctx.resume();return ctx}
function tone(f,d,type,vol,slide){try{var a=c();if(!a)return;var o=a.createOscillator(),g=a.createGain();o.type=type||'square';o.frequency.setValueAtTime(f,a.currentTime);if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(30,slide),a.currentTime+d);g.gain.setValueAtTime(vol||0.15,a.currentTime);g.gain.exponentialRampToValueAtTime(0.0001,a.currentTime+d);o.connect(g);g.connect(a.destination);o.start();o.stop(a.currentTime+d)}catch(e){}}
function seq(n,gap){n.forEach(function(f,i){setTimeout(function(){tone(f,0.12,'square',0.15)},i*gap)})}
return{tone:tone,beep:function(){tone(660,0.08,'square')},jump:function(){tone(300,0.18,'square',0.15,700)},coin:function(){seq([880,1320],70)},hit:function(){tone(180,0.2,'sawtooth',0.18,60)},win:function(){seq([523,659,784,1046],110)},lose:function(){seq([392,330,262,196],140)}}})();
window.emojiTexture=function(scene,key,emoji,size){size=size||64;if(scene.textures.exists(key))return key;var cv=document.createElement('canvas');cv.width=cv.height=size;var x=cv.getContext('2d');x.font=Math.floor(size*0.8)+'px serif';x.textAlign='center';x.textBaseline='middle';x.fillText(emoji,size/2,size/2+size*0.05);scene.textures.addCanvas(key,cv);return key};
window.shapeTexture=function(scene,key,w,h,color,radius){if(scene.textures.exists(key))return key;var g=scene.make.graphics({x:0,y:0,add:false});g.fillStyle(color,1);if(w===h&&radius>=w/2){g.fillCircle(w/2,h/2,w/2)}else{g.fillRoundedRect(0,0,w,h,radius||0)}g.generateTexture(key,w,h);g.destroy();return key};
</script>`;

const GAME_TEMPLATE = (code) => `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
${REPORTER}
${HELPERS}
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;touch-action:none}#game{width:100%;height:100%}</style>
<script src="${PHASER_URL}"></script></head>
<body><div id="game"></div>
<script>
${code}
</script></body></html>`;

const PAGE_TEMPLATE = (body) => `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${REPORTER}
${HELPERS}
<script src="https://cdn.tailwindcss.com"></script>
<style>html,body{margin:0;min-height:100%}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}</style></head>
<body>
${body}
</body></html>`;

const GAME_SYSTEM = `You write games for a mobile app called Megai using Phaser 3 (already loaded as the global "Phaser").
Return ONLY JavaScript code. No HTML, no <script> tags, no markdown fences, no explanations.
Rules:
- Create the game with: new Phaser.Game({ type: Phaser.AUTO, parent: 'game', backgroundColor: '#...', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: 480, height: 800 }, physics: {...}, scene: {...} })
- Design for a phone in portrait with TOUCH controls (tap, swipe, drag, on-screen buttons). Keyboard may be a bonus.
- NEVER load external images, audio or files (no URLs). These ready-made helpers are available as globals:
  * emojiTexture(scene, key, '🚀', 64) -> makes a sprite texture from an emoji. Use it like this.add.image(x, y, key) or this.physics.add.sprite(x, y, key).
  * shapeTexture(scene, key, width, height, 0xRRGGBB, cornerRadius) -> makes a rectangle texture (pass width === height and cornerRadius >= width/2 for a circle).
  * sfx.beep(), sfx.jump(), sfx.coin(), sfx.hit(), sfx.win(), sfx.lose(), sfx.tone(freqHz, seconds, 'square'|'sine'|'sawtooth') -> sound effects. Call them on player actions.
  Create textures in preload() or create() before using them. For anything else, draw with this.add.graphics().
- Include a score, a game-over state and a tap-to-restart.
- Match the requested visual style, audience and mood.`;

const PAGE_SYSTEM = `You build apps, websites and interactive experiences for a mobile app called Megai.
Tailwind CSS is already loaded (use Tailwind classes). Return ONLY the HTML that goes inside <body>, with any JavaScript in a <script> tag at the end.
No <html>, <head> or <body> tags, no markdown fences, no explanations.
Rules: mobile-first, touch-friendly, no external images or network calls (use emoji, CSS and inline SVG). Sound effects are available: sfx.beep(), sfx.jump(), sfx.coin(), sfx.hit(), sfx.win(), sfx.lose(). Call them on user actions, match the requested style, audience and mood.`;

const clean = (t) => String(t || '').replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();

function build(type, raw) {
  let out = clean(raw);
  if (/^game$/i.test(type)) {
    // If the model sent HTML anyway, pull out the script contents
    const m = out.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
    if (m) out = m.map(s => s.replace(/<\/?script[^>]*>/gi, '')).filter(s => !/phaser(\.min)?\.js/i.test(s)).join('\n');
    return { html: GAME_TEMPLATE(out), code: out };
  }
  // Pages: if the model sent a full document, keep only the body
  const b = out.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (b) out = b[1];
  return { html: PAGE_TEMPLATE(out), code: out };
}
/* ------------------------------------------------------------------------------------------- */

async function callGeminiOnce(model, system, type, prompt, images) {
  const parts = [{ text: `Type: ${type}\n\n${prompt}` }];
  for (const d of images) {
    const m = /^data:(.+?);base64,(.+)$/.exec(d || '');
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS) || 45000),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }] }),
  });
  const j = await r.json();
  if (!r.ok) { const e = new Error(j.error?.message || 'Gemini error'); e.status = r.status; throw e; }
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

// Retries busy/overloaded errors, then falls back to other models.
const GEMINI_FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-4-hydrogen')
  .split(',').map(x => x.trim()).filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const retryable = e => e.name === 'TimeoutError' || e.name === 'AbortError' || [404, 429, 500, 503, 504].includes(e.status) || /high demand|overloaded|unavailable|quota|rate limit|not found|no longer available/i.test(e.message || '');

async function callGemini(system, type, prompt, images) {
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACKS.filter(m => m !== GEMINI_MODEL)];
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGeminiOnce(model, system, type, prompt, images);
      } catch (e) {
        lastErr = e;
        console.log('Gemini', model, 'attempt', attempt + 1, 'failed:', e.message);
        if (!retryable(e)) throw e;
        if (e.name === 'TimeoutError' || e.name === 'AbortError') break;
        if (attempt === 0 && /high demand|overloaded|unavailable/i.test(e.message || '')) await sleep(2000);
        else break; // quota / not found: go to the next model straight away
      }
    }
  }
  throw lastErr;
}

async function callOpenAI(system, type, prompt, images) {
  const content = [{ type: 'text', text: `Type: ${type}\n\n${prompt}` }];
  for (const d of images) if (/^data:image\//.test(d || '')) content.push({ type: 'image_url', image_url: { url: d } });
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OPENAI_KEY },
    body: JSON.stringify({ model: OPENAI_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'OpenAI error');
  return j.choices?.[0]?.message?.content || '';
}

const send = (res, code, obj) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (req.method === 'POST' && req.url === '/api/generate') {
    let body = '', size = 0;
    req.on('data', c => { size += c.length; if (size > 25e6) req.destroy(); else body += c; });
    req.on('end', async () => {
      try {
        if (!GEMINI_KEY && !OPENAI_KEY) return send(res, 500, { error: 'No API key set on the server.' });
        const { type = 'Game', prompt = '', images = [] } = JSON.parse(body || '{}');
        if (prompt.length < 10) return send(res, 400, { error: 'Prompt too short.' });
        const system = /^game$/i.test(type) ? GAME_SYSTEM : PAGE_SYSTEM;
        const raw = GEMINI_KEY ? await callGemini(system, type, prompt, images) : await callOpenAI(system, type, prompt, images);
        if (!clean(raw)) return send(res, 502, { error: 'The AI returned nothing. Try again.' });
        send(res, 200, build(type, raw));
      } catch (e) {
        send(res, 500, { error: e.message });
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/fix') {
    let body = '', size = 0;
    req.on('data', c => { size += c.length; if (size > 5e6) req.destroy(); else body += c; });
    req.on('end', async () => {
      try {
        if (!GEMINI_KEY && !OPENAI_KEY) return send(res, 500, { error: 'No API key set on the server.' });
        const { type = 'Game', prompt = '', code = '', error = '' } = JSON.parse(body || '{}');
        if (!code || !error) return send(res, 400, { error: 'Missing code or error.' });
        const system = (/^game$/i.test(type) ? GAME_SYSTEM : PAGE_SYSTEM) +
          '\nYou are now FIXING a broken project. Return the complete corrected code in the same format as before, with no explanations.';
        const msg = 'Original request:\n' + prompt + '\n\nCurrent code:\n' + code + '\n\nIt crashed with this error:\n' + error + '\n\nFix the bug. Return the full corrected code only.';
        const raw = GEMINI_KEY ? await callGemini(system, type, msg, []) : await callOpenAI(system, type, msg, []);
        if (!clean(raw)) return send(res, 502, { error: 'The AI returned nothing.' });
        send(res, 200, build(type, raw));
      } catch (e) {
        send(res, 500, { error: e.message });
      }
    });
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    return fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); return res.end('index.html not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  }

  send(res, 404, { error: 'Not found' });
}).listen(PORT, () => console.log('Megai running on http://localhost:' + PORT));
