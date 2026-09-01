import { MSG, ABORT_REASON_TEXT } from '../shared/messages.js';

// 日志事件 -> 人话说明
const EVENT_TEXT = {
  scheduled: '已安排本次执行',
  skipped_today: '今天已经跑过了',
  auto_disabled: '自动执行是关闭的',
  run_start: '开始执行',
  run_done: '执行完成',
  run_abort: '中途停下了',
  run_failed: '执行失败',
  run_error: '执行出错',
  retry_scheduled: '稍后自动重试',
  retry_exhausted: '重试次数用完了',
  handshake_timeout: '页面加载太慢',
  chat_url_try: '正在打开聊天页',
  chat_url_no_list: '这个地址上没有会话列表',
  chat_frame_ready: '已找到会话列表',
  chat_page_unavailable: '打不开聊天页',
  ledger_cleared: '已清空今天的发送记录',
  session_start: '页面上开工了',
  payload_info: '发送内容',
  session_done: '页面上收工了',
  chat_unreadable: '聊天记录没加载出来，跳过',
  partial_progress: '中断前已发出部分',
  scan_done: '会话扫描完成',
  scroll_stuck: '列表滚不动了',
  dom_debug_input: '[排查] 输入框结构',
  dom_debug_chat: '[排查] 消息区',
  dom_debug_scan: '[排查] 扫描结果',
  targets_ready: '本次要续的人',
  truncated: '超出上限，剩下的下次再说',
  no_identity: '认不出是谁，已跳过',
  nothing_to_do: '没有需要续的人',
  sweep_again: '再找一遍漏掉的人',
  sent: '已发送',
  skipped_already_sent: '页面显示今天已聊过，跳过',
  send_failed: '发送失败',
  send_unverified: '已发送（页面上没确认到）',
  unreached: '这些人没轮到',
  wrong_conversation: '点开的不是这个人，已跳过',
  input_failed: '内容没写进输入框',
  blocked_login: '抖音没登录',
  blocked_captcha: '抖音要求安全验证',
  dom_list_missing: '找不到会话列表',
  consecutive_failures: '连续失败，已停下',
  logs_cleared: '日志已清空',
  run_skipped_busy: '上一次还在跑，跳过',
  config_updated: '设置已更新'
};

const $ = (id) => document.getElementById(id);

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDateTime(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp || {});
    });
  });
}

function renderLogs(logs) {
  const ul = $('logs');
  ul.textContent = '';
  if (!logs || logs.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '暂无日志';
    ul.appendChild(li);
    return;
  }
  for (const entry of logs.slice(0, 20)) {
    const li = document.createElement('li');
    li.className = entry.level || 'info';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = fmtTime(entry.ts);
    const m = document.createElement('span');
    m.className = 'm';
    const label = EVENT_TEXT[entry.event] || entry.event;
    // 昵称单独成 span 以便高亮（用 textContent，避免 innerHTML 注入风险）
    if (entry.nickname) {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = entry.nickname + '：';
      m.appendChild(who);
    }
    m.appendChild(document.createTextNode(label + (entry.detail ? ' — ' + entry.detail : '')));
    li.append(t, m);
    ul.appendChild(li);
  }
}

function describeToday(state, today, busy) {
  if (busy) return { text: '正在执行…', cls: '' };
  if (state.lastSuccessDate === today) {
    return { text: `已完成，发送 ${state.todaySentCount || 0} 人`, cls: 'ok' };
  }
  const r = state.lastResult;
  if (r && r.ok === false) {
    if (r.kind === 'abort') {
      return { text: ABORT_REASON_TEXT[r.reason] || '需要人工处理', cls: 'err' };
    }
    return { text: '上次未完成，等待重试', cls: 'err' };
  }
  return { text: '今天尚未执行', cls: '' };
}

function describeResult(result) {
  if (!result) return { text: '--', cls: '' };
  if (result.ok) {
    return { text: `成功 ${result.sent}，跳过 ${result.skipped}，失败 ${result.failed}`, cls: 'ok' };
  }
  if (result.kind === 'abort') return { text: ABORT_REASON_TEXT[result.reason] || result.detail || '已中止', cls: 'err' };
  return { text: result.detail || '失败', cls: 'err' };
}

async function refresh() {
  const data = await send(MSG.GET_STATE);
  if (!data || !data.state) {
    $('todayStatus').textContent = '无法读取后台状态';
    return;
  }
  const { config, state, logs, busy, today } = data;

  const pill = $('autoState');
  pill.textContent = config.autoRunEnabled ? '自动执行：开' : '自动执行：关';
  pill.className = 'pill ' + (config.autoRunEnabled ? 'on' : 'off');

  const todayInfo = describeToday(state, today, busy);
  $('todayStatus').textContent = todayInfo.text;
  $('todayStatus').className = 'value ' + todayInfo.cls;

  $('lastRun').textContent = fmtDateTime(state.lastRunAt);

  const resInfo = describeResult(state.lastResult);
  $('lastResult').textContent = resInfo.text;
  $('lastResult').className = 'value ' + resInfo.cls;

  $('runNow').disabled = Boolean(busy);
  $('runNow').textContent = busy ? '执行中…' : '立即执行一次';

  renderLogs(logs);
}

$('runNow').addEventListener('click', async () => {
  $('runNow').disabled = true;
  $('runNow').textContent = '执行中…';
  const resp = await send(MSG.MANUAL_RUN);
  if (resp && resp.ok === false) {
    $('todayStatus').textContent = resp.error || '启动失败';
  }
  setTimeout(refresh, 1200);
});

$('openOptions').addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  else chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
});

$('clearLogs').addEventListener('click', async () => {
  await send(MSG.CLEAR_LOGS);
  refresh();
});

refresh();
setInterval(refresh, 3000);