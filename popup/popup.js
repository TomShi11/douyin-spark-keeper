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
  if (!ts) return '暂无';
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

function getEventIcon(event, level) {
  if (level === 'error') return '❌';
  if (level === 'warn') return '⚠️';
  if (event === 'sent' || event === 'session_done' || event === 'run_done') return '🔥';
  if (event === 'skipped_already_sent' || event === 'skipped_today') return '⏭️';
  if (event === 'wrong_conversation' || event === 'no_identity' || event === 'chat_unreadable') return '⚠️';
  if (event === 'blocked_login' || event === 'blocked_captcha' || event === 'send_failed' || event === 'run_failed' || event === 'run_error') return '❌';
  return 'ℹ️';
}

function renderLogs(logs) {
  const ul = $('logs');
  if (!ul) return;
  ul.textContent = '';

  const countBadge = $('logCountBadge');
  if (countBadge) {
    countBadge.textContent = String((logs && logs.length) || 0);
  }

  if (!logs || logs.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.textContent = '📋';
    const txt = document.createElement('span');
    txt.textContent = '暂无执行日志';
    li.append(icon, txt);
    ul.appendChild(li);
    return;
  }

  for (const entry of logs.slice(0, 25)) {
    const li = document.createElement('li');
    li.className = entry.level || 'info';

    const icon = document.createElement('span');
    icon.className = 'log-icon';
    icon.textContent = getEventIcon(entry.event, entry.level);

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = fmtTime(entry.ts);

    const m = document.createElement('span');
    m.className = 'm';
    const label = EVENT_TEXT[entry.event] || entry.event;

    // 昵称单独成 span 高亮
    if (entry.nickname) {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = entry.nickname;
      m.appendChild(who);
    }
    m.appendChild(document.createTextNode((entry.nickname ? ' ' : '') + label + (entry.detail ? ' — ' + entry.detail : '')));
    li.append(icon, t, m);
    ul.appendChild(li);
  }
}

function describeDashboard(state, today, busy, config) {
  if (busy) {
    return {
      icon: '⚡',
      headline: '正在自动续火花…',
      subline: '正在执行私信扫描与发送流程',
      statusText: '正在执行…',
      statusCls: 'ok'
    };
  }
  if (state.lastSuccessDate === today) {
    const count = state.todaySentCount || 0;
    return {
      icon: '🔥',
      headline: '今日火花已全部续上',
      subline: count > 0 ? `已成功向 ${count} 位好友发送火花` : '今天没有需要续火花的好友',
      statusText: `已完成，发送 ${count} 人`,
      statusCls: 'ok'
    };
  }
  const r = state.lastResult;
  if (r && r.ok === false) {
    if (r.kind === 'abort') {
      const reasonText = ABORT_REASON_TEXT[r.reason] || r.detail || '需要人工处理';
      return {
        icon: '⚠️',
        headline: '上次执行已中断',
        subline: reasonText,
        statusText: reasonText,
        statusCls: 'err'
      };
    }
    return {
      icon: '❌',
      headline: '上次执行未完成',
      subline: r.detail || '等待下一次自动重试',
      statusText: '上次未完成，等待重试',
      statusCls: 'err'
    };
  }
  if (!config.autoRunEnabled) {
    return {
      icon: '⏸️',
      headline: '自动续火已暂停',
      subline: '可点击下方按钮手动执行一次',
      statusText: '自动执行已关闭',
      statusCls: ''
    };
  }
  return {
    icon: '✨',
    headline: '今天尚未执行',
    subline: '等待定时触发或点击下方立即执行',
    statusText: '今天尚未执行',
    statusCls: ''
  };
}

function describeResult(result) {
  if (!result) return { text: '暂无', cls: '' };
  if (result.ok) {
    return { text: `成功 ${result.sent} / 跳过 ${result.skipped}`, cls: 'ok' };
  }
  if (result.kind === 'abort') {
    return { text: ABORT_REASON_TEXT[result.reason] || result.detail || '已中止', cls: 'err' };
  }
  return { text: result.detail || '失败', cls: 'err' };
}

async function refresh() {
  const data = await send(MSG.GET_STATE);
  if (!data || !data.state) {
    if ($('todayHeadline')) $('todayHeadline').textContent = '无法读取后台状态';
    if ($('todayStatus')) $('todayStatus').textContent = '无法读取后台状态';
    return;
  }
  const { config, state, logs, busy, today } = data;

  // 状态指示器
  const autoEl = $('autoState');
  if (autoEl) {
    const isAuto = Boolean(config.autoRunEnabled);
    autoEl.className = 'status-indicator pill ' + (isAuto ? 'on' : 'off');
    const textEl = autoEl.querySelector('.status-text');
    if (textEl) {
      textEl.textContent = isAuto ? '自动运行中' : '已暂停';
    } else {
      autoEl.textContent = isAuto ? '自动运行中' : '已暂停';
    }
  }

  // 状态看板
  const info = describeDashboard(state, today, busy, config);
  if ($('statusIcon')) $('statusIcon').textContent = info.icon;
  if ($('todayHeadline')) $('todayHeadline').textContent = info.headline;
  if ($('todaySubline')) $('todaySubline').textContent = info.subline;
  if ($('todayStatus')) {
    $('todayStatus').textContent = info.statusText;
    $('todayStatus').className = 'value ' + info.statusCls;
  }

  // 数据栅格
  if ($('statTodayCount')) $('statTodayCount').textContent = String(state.todaySentCount || 0);

  if ($('lastRun')) $('lastRun').textContent = fmtDateTime(state.lastRunAt);

  const resInfo = describeResult(state.lastResult);
  if ($('lastResult')) {
    $('lastResult').textContent = resInfo.text;
    $('lastResult').className = 'stat-val value ' + resInfo.cls;
  }

  // 运行按钮
  const runBtn = $('runNow');
  if (runBtn) {
    runBtn.disabled = Boolean(busy);
    const textEl = runBtn.querySelector('.btn-text');
    if (busy) {
      runBtn.classList.add('loading');
      if (textEl) textEl.textContent = '执行中…';
      else runBtn.textContent = '执行中…';
    } else {
      runBtn.classList.remove('loading');
      if (textEl) textEl.textContent = '立即执行一次';
      else runBtn.textContent = '立即执行一次';
    }
  }

  renderLogs(logs);
}

const runNowBtn = $('runNow');
if (runNowBtn) {
  runNowBtn.addEventListener('click', async () => {
    runNowBtn.disabled = true;
    runNowBtn.classList.add('loading');
    const textEl = runNowBtn.querySelector('.btn-text');
    if (textEl) textEl.textContent = '启动中…';
    await send(MSG.RUN_NOW);
    setTimeout(refresh, 600);
  });
}

const openOptionsBtn = $('openOptions');
if (openOptionsBtn) {
  openOptionsBtn.addEventListener('click', () => {
    if (chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });
}

const openChatBtn = $('openChat');
if (openChatBtn) {
  openChatBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.douyin.com/chat?isPopup=1' });
  });
}

const clearLogsBtn = $('clearLogs');
if (clearLogsBtn) {
  clearLogsBtn.addEventListener('click', async () => {
    await send(MSG.CLEAR_LOGS);
    refresh();
  });
}

refresh();
setInterval(refresh, 3000);
