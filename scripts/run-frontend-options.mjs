import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(repoRoot, 'public', 'index.html');

const port = Number(process.env.FRONTEND_OPTIONS_PORT || 3210);
const baseUrl = `http://127.0.0.1:${port}`;

const html = readFileSync(htmlPath, 'utf8');

const uiOptions = [
  { label: 'Login (open auth gate)', id: 'loginOpenBtn', handler: /loginOpenBtn\.addEventListener\('click',\s*\(\)\s*=>\s*openAuthGate\(/ },
  { label: 'Logout', id: 'logoutBtn', handler: /logoutBtn\.addEventListener\('click',\s*logout\)/ },
  { label: 'Full Screen', id: 'fullscreenToggle', handler: /fullscreenToggle\.addEventListener\('click',\s*toggleFullscreen\)/ },
  { label: 'Voice On\/Off', id: 'voiceToggle', handler: /voiceToggle\.addEventListener\('click',\s*toggleVoice\)/ },
  { label: 'Live On\/Off', id: 'liveToggle', handler: /liveToggle\.addEventListener\('click',\s*toggleLiveMode\)/ },
  { label: 'New Chat', id: 'newChatBtn', handler: /newChatBtn\.addEventListener\('click',\s*startNewChat\)/ },
  { label: 'History Search', id: 'historySearchInput', handler: /historySearchInput\.addEventListener\('input',\s*updateHistorySearchState\)/ },
  { label: 'Clear Search', id: 'historySearchClear', handler: /historySearchClear\.addEventListener\('click',\s*clearHistorySearch\)/ },
  { label: 'MIC', id: 'micBtn', handler: /micBtn\.addEventListener\('click',\s*toggleMic\)/ },
  { label: 'SEND', id: 'sendBtn', handler: /sendBtn\.addEventListener\('click',\s*\(\)\s*=>\s*sendMessage\(\)\)/ },
  { label: 'Create Account', id: 'signupBtn', handler: /signupBtn\.addEventListener\('click',\s*\(\)\s*=>\s*signup\(\)\)/ },
  { label: 'Login (auth form)', id: 'loginBtn', handler: /loginBtn\.addEventListener\('click',\s*\(\)\s*=>\s*login\(\)\)/ },
  { label: 'Continue as Guest', id: 'authCloseBtn', handler: /authCloseBtn\.addEventListener\('click',\s*closeAuthGate\)/ }
];

const functionExpectations = [
  { label: 'toggleFullscreen function', pattern: /async function toggleFullscreen\(/ },
  { label: 'toggleVoice function', pattern: /function toggleVoice\(/ },
  { label: 'toggleLiveMode function', pattern: /function toggleLiveMode\(/ },
  { label: 'toggleMic function', pattern: /function toggleMic\(/ },
  { label: 'startNewChat function', pattern: /function startNewChat\(/ },
  { label: 'updateHistorySearchState function', pattern: /function updateHistorySearchState\(/ },
  { label: 'clearHistorySearch function', pattern: /function clearHistorySearch\(/ }
];

const results = [];

function addResult(option, ok, detail) {
  results.push({ option, ok, detail });
}

for (const option of uiOptions) {
  const hasElement = html.includes(`id="${option.id}"`);
  const hasHandler = option.handler.test(html);
  addResult(
    option.label,
    hasElement && hasHandler,
    hasElement && hasHandler
      ? 'element and click handler present'
      : `element=${hasElement}, handler=${hasHandler}`
  );
}

for (const check of functionExpectations) {
  const ok = check.pattern.test(html);
  addResult(check.label, ok, ok ? 'present' : 'missing');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`, { method: 'GET' });
      if (response.ok) return;
    } catch {
      // Ignore startup connection errors.
    }

    await sleep(250);
  }

  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function requestText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text().catch(() => '');
  return { response, text };
}

function hasAllowedHeader(response, expectedHeader) {
  const value = response.headers.get('access-control-allow-headers') || '';

  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .includes(expectedHeader.toLowerCase());
}

async function runApiChecks() {
  const sessionId = `frontend_option_session_${Date.now()}`;
  const email = `frontend.option.${Date.now()}@example.com`;
  const password = 'StrongPass123';

  const home = await requestText(`${baseUrl}/`, { method: 'GET' });
  const csp = home.response.headers.get('content-security-policy') || '';

  addResult(
    'Homepage CSP allows inline app script',
    home.response.ok && /script-src[^;]*'unsafe-inline'/.test(csp),
    home.response.ok
      ? `status=${home.response.status}, csp=${csp || 'missing'}`
      : `status=${home.response.status}`
  );

  const chatOptions = await requestText(`${baseUrl}/api/chat`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type, Authorization'
    }
  });

  addResult(
    'OPTIONS /api/chat',
    chatOptions.response.ok
      && chatOptions.response.headers.get('access-control-allow-origin') === '*'
      && hasAllowedHeader(chatOptions.response, 'authorization'),
    chatOptions.response.ok
      ? `status=${chatOptions.response.status}, allow_headers=${chatOptions.response.headers.get('access-control-allow-headers') || 'missing'}`
      : `status=${chatOptions.response.status}`
  );

  const authOptions = await requestText(`${baseUrl}/api/auth`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://example.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type, Authorization'
    }
  });

  addResult(
    'OPTIONS /api/auth',
    authOptions.response.ok
      && authOptions.response.headers.get('access-control-allow-origin') === '*'
      && hasAllowedHeader(authOptions.response, 'authorization'),
    authOptions.response.ok
      ? `status=${authOptions.response.status}, allow_headers=${authOptions.response.headers.get('access-control-allow-headers') || 'missing'}`
      : `status=${authOptions.response.status}`
  );

  const historyOptions = await requestText(`${baseUrl}/api/history`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://example.com',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Content-Type, Authorization'
    }
  });

  addResult(
    'OPTIONS /api/history',
    historyOptions.response.ok
      && historyOptions.response.headers.get('access-control-allow-origin') === '*'
      && hasAllowedHeader(historyOptions.response, 'authorization'),
    historyOptions.response.ok
      ? `status=${historyOptions.response.status}, allow_headers=${historyOptions.response.headers.get('access-control-allow-headers') || 'missing'}`
      : `status=${historyOptions.response.status}`
  );

  const signup = await requestJson(`${baseUrl}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'signup',
      name: 'Frontend Option User',
      email,
      password
    })
  });

  addResult(
    'Create Account API',
    signup.response.ok && signup.data?.ok === true && signup.data?.action === 'signup',
    signup.response.ok
      ? `status=${signup.response.status}`
      : `status=${signup.response.status}, error=${signup.data?.error || 'unknown'}`
  );

  const login = await requestJson(`${baseUrl}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'login',
      email,
      password
    })
  });

  addResult(
    'Login API',
    login.response.ok && login.data?.ok === true && login.data?.action === 'login',
    login.response.ok
      ? `status=${login.response.status}`
      : `status=${login.response.status}, error=${login.data?.error || 'unknown'}`
  );

  const logout = await requestJson(`${baseUrl}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'logout' })
  });

  addResult(
    'Logout API',
    logout.response.ok && logout.data?.ok === true && logout.data?.action === 'logout',
    logout.response.ok
      ? `status=${logout.response.status}`
      : `status=${logout.response.status}, error=${logout.data?.error || 'unknown'}`
  );

  const history = await requestJson(
    `${baseUrl}/api/history?sessionId=${encodeURIComponent(sessionId)}`,
    { method: 'GET' }
  );

  addResult(
    'History API',
    history.response.ok && Array.isArray(history.data?.messages),
    history.response.ok
      ? `status=${history.response.status}, database=${Boolean(history.data?.database)}`
      : `status=${history.response.status}, error=${history.data?.error || 'unknown'}`
  );

  const chat = await requestJson(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      system: 'You are a concise assistant.',
      messages: [{ role: 'user', content: 'Reply with one short sentence.' }]
    })
  });

  addResult(
    'SEND API (chat)',
    chat.response.ok && typeof chat.data?.reply === 'string' && chat.data.reply.trim().length > 0,
    chat.response.ok
      ? `status=${chat.response.status}, reply_length=${chat.data.reply.length}`
      : `status=${chat.response.status}, error=${chat.data?.error || 'unknown'}`
  );
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  let startupLog = '';
  server.stdout.on('data', (chunk) => {
    startupLog += String(chunk);
  });

  try {
    await waitForServer(25000);
    await runApiChecks();
  } catch (err) {
    addResult('Server/API execution', false, err.message || 'Unknown failure');
  } finally {
    if (!server.killed) {
      server.kill('SIGTERM');
    }
  }

  const passCount = results.filter((result) => result.ok).length;
  const failCount = results.length - passCount;

  console.log(`\nFrontend Option Run: ${passCount}/${results.length} passed`);
  for (const result of results) {
    const mark = result.ok ? 'PASS' : 'FAIL';
    console.log(`${mark} | ${result.option} | ${result.detail}`);
  }

  if (stderr.trim()) {
    console.log('\nServer stderr (trimmed):');
    console.log(stderr.trim());
  }

  if (startupLog.trim()) {
    console.log('\nServer startup log (trimmed):');
    console.log(startupLog.trim());
  }

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

await main();
