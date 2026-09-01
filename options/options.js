import { DEFAULT_CONFIG } from '../shared/config.js';
import { MSG } from '../shared/messages.js';
import { normalizeConfig, parseSelectorOverrides } from '../shared/storage.js';

const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp || {});
    });
  });
}

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + (cls || '');
  if (text) setTimeout(() => {
    if (el.textContent === text) {
      el.textContent = '';
      el.className = 'status';
    }
  }, 4000);
}

function fillForm(config) {
  $('autoRunEnabled').checked = Boolean(config.autoRunEnabled);
  $('chatUrl').value = config.chatUrl || '';
  $('sparkText').value = config.sparkText || '';
  $('debugDom').checked = Boolean(config.debugDom);
  $('whitelist').value = (config.whitelist || []).join('\n');
  $('blacklist').value = (config.blacklist || []).join('\n');
  $('maxPerRun').value = config.maxPerRun;
  $('minDelayMs').value = config.minDelayMs;
  $('maxDelayMs').value = config.maxDelayMs;
  $('selectorOverrides').value = config.selectorOverrides ? JSON.stringify(config.selectorOverrides, null, 2) : '';
}

async function load() {
  const { config } = await chrome.storage.local.get('config');
  fillForm(normalizeConfig(config));
}

async function save() {
  const parsed = parseSelectorOverrides($('selectorOverrides').value);
  if (!parsed.ok) {
    setStatus('选择器覆盖已忽略：' + parsed.error, 'err');
  }
  const next = normalizeConfig({
    autoRunEnabled: $('autoRunEnabled').checked,
    chatUrl: $('chatUrl').value,
    sparkText: $('sparkText').value,
    debugDom: $('debugDom').checked,
    whitelist: $('whitelist').value.split('\n'),
    blacklist: $('blacklist').value.split('\n'),
    maxPerRun: $('maxPerRun').value,
    minDelayMs: $('minDelayMs').value,
    maxDelayMs: $('maxDelayMs').value,
    selectorOverrides: parsed.ok ? parsed.value : null
  });
  await chrome.storage.local.set({ config: next });
  fillForm(next);
  await send(MSG.CONFIG_UPDATED);
  if (parsed.ok) setStatus('已保存', 'ok');
}

$('save').addEventListener('click', save);

$('reset').addEventListener('click', async () => {
  const next = normalizeConfig({ ...DEFAULT_CONFIG });
  await chrome.storage.local.set({ config: next });
  fillForm(next);
  await send(MSG.CONFIG_UPDATED);
  setStatus('已恢复默认设置', 'ok');
});

$('clearLogs').addEventListener('click', async () => {
  await send(MSG.CLEAR_LOGS);
  setStatus('日志已清空', 'ok');
});

$('showDiagnostics').addEventListener('click', async () => {
  const pre = $('diagnostics');
  pre.hidden = !pre.hidden;
  if (pre.hidden) return;
  const { state } = await chrome.storage.local.get('state');
  const diag = state && state.lastResult && state.lastResult.diagnostics;
  if (!diag) {
    pre.textContent = '暂无诊断信息（识别失败时会自动采集）。';
    return;
  }
  pre.textContent = JSON.stringify(diag, null, 2);
});

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

$('showLedger').addEventListener('click', async () => {
  const pre = $('ledger');
  pre.hidden = !pre.hidden;
  if (pre.hidden) return;
  const resp = await send(MSG.GET_SENT_LEDGER);
  const entries = (resp && resp.ledger && resp.ledger.entries) || [];
  if (entries.length === 0) {
    pre.textContent = '今天还没给任何人发过。';
    return;
  }
  pre.textContent = `今天已经发过 ${entries.length} 人：\n` +
    entries.map((e, i) => `${i + 1}. ${e.nickname || '(昵称未记录)'}  ${fmtTime(e.ts)}`).join('\n');
});

$('clearLedger').addEventListener('click', async () => {
  const resp = await send(MSG.CLEAR_SENT_LEDGER);
  if (resp && resp.ok) {
    setStatus('统计记录已清空（是否重发仍由页面聊天记录决定）', 'ok');
    const pre = $('ledger');
    if (!pre.hidden) pre.textContent = '今天还没给任何人发过。';
  } else {
    setStatus('清空失败：' + ((resp && resp.error) || '未知错误'), 'err');
  }
});

$('showDefaults').addEventListener('click', () => {
  const pre = $('defaults');
  const api = globalThis.DSK_SELECTORS;
  pre.hidden = !pre.hidden;
  if (!pre.hidden) {
    pre.textContent = api ? JSON.stringify(api.DEFAULT_SELECTORS, null, 2) : '默认配置加载失败，请查看 content/dom-selectors.js';
  }
});

load();