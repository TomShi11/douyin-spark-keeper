import { DEFAULT_CONFIG } from '../shared/config.js';
import { MSG } from '../shared/messages.js';
import { normalizeConfig, parseSelectorOverrides } from '../shared/storage.js';

const $ = (id) => document.getElementById(id);

let baselineSnapshot = '';
let toastTimer = null;

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp || {});
    });
  });
}

function showToast(text, type = 'ok') {
  const toast = $('toast');
  const icon = $('toastIcon');
  const msg = $('toastMsg');
  if (!toast || !msg) return;

  clearTimeout(toastTimer);
  msg.textContent = text;
  if (icon) icon.textContent = type === 'ok' ? '✓' : '⚠️';
  toast.className = 'toast-popup toast-' + type;
  toast.hidden = false;

  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

function setStatus(text, cls) {
  const el = $('status');
  if (el) {
    el.textContent = text;
    el.className = 'status-msg status ' + (cls || '');
    if (text) {
      setTimeout(() => {
        if (el.textContent === text) {
          el.textContent = '';
          el.className = 'status-msg status';
        }
      }, 4000);
    }
  }
  if (text) {
    showToast(text, cls === 'err' ? 'err' : 'ok');
  }
}

function countLines(text) {
  if (!text) return 0;
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean).length;
}

function updateCounters() {
  const whiteEl = $('whitelist');
  const blackEl = $('blacklist');
  const whiteCount = $('whitelistCount');
  const blackCount = $('blacklistCount');

  if (whiteEl && whiteCount) {
    const n = countLines(whiteEl.value);
    whiteCount.textContent = `${n} 人`;
  }
  if (blackEl && blackCount) {
    const n = countLines(blackEl.value);
    blackCount.textContent = `${n} 人`;
  }
}

function getFormSnapshot() {
  return JSON.stringify({
    autoRunEnabled: $('autoRunEnabled').checked,
    chatUrl: ($('chatUrl').value || '').trim(),
    sparkText: ($('sparkText').value || '').trim(),
    debugDom: $('debugDom').checked,
    whitelist: ($('whitelist').value || '').trim(),
    blacklist: ($('blacklist').value || '').trim(),
    maxPerRun: $('maxPerRun').value,
    minDelayMs: $('minDelayMs').value,
    maxDelayMs: $('maxDelayMs').value,
    selectorOverrides: ($('selectorOverrides').value || '').trim()
  });
}

function markClean() {
  baselineSnapshot = getFormSnapshot();
  const dirty = $('dirtyIndicator');
  if (dirty) dirty.hidden = true;
  const saveBtn = $('save');
  if (saveBtn) saveBtn.classList.remove('is-dirty');
}

function checkDirty() {
  const current = getFormSnapshot();
  const isDirty = baselineSnapshot !== '' && current !== baselineSnapshot;
  const dirty = $('dirtyIndicator');
  if (dirty) dirty.hidden = !isDirty;
  const saveBtn = $('save');
  if (saveBtn) {
    if (isDirty) saveBtn.classList.add('is-dirty');
    else saveBtn.classList.remove('is-dirty');
  }
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

  updateCounters();
  markClean();
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
  if (parsed.ok) setStatus('设置已成功保存', 'ok');
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
  const copyBtn = $('copyDiagnostics');
  pre.hidden = !pre.hidden;
  if (copyBtn) copyBtn.hidden = pre.hidden;
  if (pre.hidden) return;
  const { state } = await chrome.storage.local.get('state');
  const diag = state && state.lastResult && state.lastResult.diagnostics;
  if (!diag) {
    pre.textContent = '暂无诊断信息（识别失败时会自动采集）。';
    return;
  }
  pre.textContent = JSON.stringify(diag, null, 2);
});

const copyDiagBtn = $('copyDiagnostics');
if (copyDiagBtn) {
  copyDiagBtn.addEventListener('click', async () => {
    const text = $('diagnostics').textContent;
    if (text) {
      await navigator.clipboard.writeText(text);
      const textEl = copyDiagBtn.querySelector('.btn-text');
      if (textEl) {
        const orig = textEl.textContent;
        textEl.textContent = '✓ 已复制';
        setTimeout(() => { textEl.textContent = orig; }, 1800);
      }
    }
  });
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderLedgerBadges(entries) {
  const container = $('ledgerCardView');
  const list = $('ledgerList');
  if (!container || !list) return;

  list.innerHTML = '';
  if (!entries || entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ledger-empty';
    empty.textContent = '今天还没给任何人发过火花。';
    list.appendChild(empty);
    return;
  }

  entries.forEach((e, i) => {
    const item = document.createElement('div');
    item.className = 'ledger-item';

    const idx = document.createElement('span');
    idx.className = 'ledger-idx';
    idx.textContent = `#${i + 1}`;

    const name = document.createElement('span');
    name.className = 'ledger-name';
    name.textContent = e.nickname || '(昵称未记录)';

    const time = document.createElement('span');
    time.className = 'ledger-time';
    time.textContent = fmtTime(e.ts);

    item.append(idx, name, time);
    list.appendChild(item);
  });
}

$('showLedger').addEventListener('click', async () => {
  const cardView = $('ledgerCardView');
  const pre = $('ledger');
  const isHidden = cardView ? !cardView.hidden : !pre.hidden;

  if (cardView) cardView.hidden = isHidden;
  pre.hidden = true; // 优先以现代卡片化徽章展示
  const btnText = $('showLedger').querySelector('.btn-text');
  if (btnText) {
    btnText.textContent = isHidden ? '展开今日发送清单' : '收起今日发送清单';
  }

  if (isHidden) return;

  const resp = await send(MSG.GET_SENT_LEDGER);
  const entries = (resp && resp.ledger && resp.ledger.entries) || [];

  renderLedgerBadges(entries);

  if (entries.length === 0) {
    pre.textContent = '今天还没给任何人发过。';
  } else {
    pre.textContent =
      `今天已经发过 ${entries.length} 人：\n` +
      entries.map((e, i) => `${i + 1}. ${e.nickname || '(昵称未记录)'}  ${fmtTime(e.ts)}`).join('\n');
  }
});

$('clearLedger').addEventListener('click', async () => {
  const resp = await send(MSG.CLEAR_SENT_LEDGER);
  if (resp && resp.ok) {
    setStatus('统计记录已清空（是否重发仍由页面聊天记录决定）', 'ok');
    const pre = $('ledger');
    pre.textContent = '今天还没给任何人发过。';
    renderLedgerBadges([]);
  } else {
    setStatus('清空失败：' + ((resp && resp.error) || '未知错误'), 'err');
  }
});

$('showDefaults').addEventListener('click', () => {
  const pre = $('defaults');
  const copyBtn = $('copyDefaults');
  const api = globalThis.DSK_SELECTORS;
  pre.hidden = !pre.hidden;
  if (copyBtn) copyBtn.hidden = pre.hidden;
  if (!pre.hidden) {
    pre.textContent = api
      ? JSON.stringify(api.DEFAULT_SELECTORS, null, 2)
      : '默认配置加载失败，请查看 content/dom-selectors.js';
  }
});

const copyDefBtn = $('copyDefaults');
if (copyDefBtn) {
  copyDefBtn.addEventListener('click', async () => {
    const text = $('defaults').textContent;
    if (text) {
      await navigator.clipboard.writeText(text);
      const textEl = copyDefBtn.querySelector('.btn-text');
      if (textEl) {
        const orig = textEl.textContent;
        textEl.textContent = '✓ 已复制';
        setTimeout(() => { textEl.textContent = orig; }, 1800);
      }
    }
  });
}

// 预设候选地址点击填充
document.querySelectorAll('.preset-tag').forEach((btn) => {
  btn.addEventListener('click', () => {
    const url = btn.getAttribute('data-url');
    if (url) {
      $('chatUrl').value = url;
      checkDirty();
    }
  });
});

// 快捷 Emoji 点击填充
document.querySelectorAll('.quick-emoji-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const emoji = btn.getAttribute('data-emoji');
    if (emoji) {
      $('sparkText').value = emoji;
      checkDirty();
    }
  });
});

// 实时统计行数与变更检测
['whitelist', 'blacklist'].forEach((id) => {
  const el = $(id);
  if (el) {
    el.addEventListener('input', () => {
      updateCounters();
      checkDirty();
    });
  }
});

// 监听所有输入字段触发未保存修改检测
[
  'autoRunEnabled',
  'chatUrl',
  'sparkText',
  'debugDom',
  'maxPerRun',
  'minDelayMs',
  'maxDelayMs',
  'selectorOverrides'
].forEach((id) => {
  const el = $(id);
  if (el) {
    el.addEventListener('input', checkDirty);
    el.addEventListener('change', checkDirty);
  }
});

// 快速锚点导航高亮切换
const navLinks = document.querySelectorAll('.nav-item');
navLinks.forEach((link) => {
  link.addEventListener('click', () => {
    navLinks.forEach((l) => l.classList.remove('active'));
    link.classList.add('active');
  });
});

load();
