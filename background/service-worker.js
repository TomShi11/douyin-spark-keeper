/*
 * 后台调度：启动后随机延迟 -> 后台非激活标签打开抖音私信 -> 握手 -> 长连接执行 -> 收尾。
 */
import {
  ALARM_RUN,
  ALARM_RETRY,
  STARTUP_DELAY_MIN_MINUTES,
  STARTUP_DELAY_MAX_MINUTES,
  RETRY_PERIOD_MINUTES,
  MAX_RETRY_PER_DAY,
  HANDSHAKE_TIMEOUT_MS,
  SESSION_TIMEOUT_MS,
  PORT_HEARTBEAT_MS,
  PROBE_TIMEOUT_MS,
  FRAME_PROBE_INTERVAL_MS,
  CHAT_READY_TIMEOUT_MS
} from '../shared/config.js';
import { MSG, ABORT_REASON_TEXT } from '../shared/messages.js';
import {
  getConfig,
  chatUrlCandidates,
  getState,
  patchState,
  addLog,
  addLogs,
  clearLogs,
  getLogs,
  todayKey,
  isDoneToday,
  makeLogEntry,
  getSentLedger,
  addSentEntries,
  clearSentLedger
} from '../shared/storage.js';

/* ------------------------------ 徽标 ------------------------------ */

async function setBadge(text, color) {
  try {
    await chrome.action.setBadgeText({ text: text || '' });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
  } catch (err) {
    /* ignore */
  }
}

const BADGE = {
  running: () => setBadge('…', '#8a8a8a'),
  success: (n) => setBadge(String(n), '#1aad19'),
  error: () => setBadge('!', '#e34d4d'),
  clear: () => setBadge('')
};

/* ------------------------------ 并发保护 ------------------------------ */

async function sessionGet(key) {
  try {
    const data = await chrome.storage.session.get(key);
    return data[key];
  } catch (err) {
    return undefined;
  }
}

async function sessionSet(obj) {
  try {
    await chrome.storage.session.set(obj);
  } catch (err) {
    /* ignore */
  }
}

async function isRunInProgress() {
  const started = await sessionGet('runInProgress');
  if (!started) return false;
  // 超时的旧标记视为无效
  if (Date.now() - Number(started) > SESSION_TIMEOUT_MS + 60000) {
    await sessionSet({ runInProgress: null });
    return false;
  }
  return true;
}

// 关闭上次遗留的扩展标签（SW 重启后）
async function closeOrphanTab() {
  const tabId = await sessionGet('createdTabId');
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.url && tab.url.includes('douyin.com')) await chrome.tabs.remove(tabId);
  } catch (err) {
    /* 标签已不存在 */
  }
  await sessionSet({ createdTabId: null });
}

/* ------------------------------ 调度 ------------------------------ */

function randomStartupDelayMinutes() {
  const span = STARTUP_DELAY_MAX_MINUTES - STARTUP_DELAY_MIN_MINUTES;
  return STARTUP_DELAY_MIN_MINUTES + Math.random() * span;
}

async function scheduleDailyRun(trigger) {
  const config = await getConfig();
  const state = await getState();
  const today = todayKey();

  if (state.lastSuccessDate !== today) {
    await patchState({ todaySentCount: 0, retryCount: 0 });
    await BADGE.clear();
  }
  // 跨天把「今天已发过谁」的名单作废
  if (state.lastLedgerDate !== today) {
    await clearSentLedger();
    await patchState({ lastLedgerDate: today });
  }

  if (!config.autoRunEnabled) {
    await addLog('info', 'auto_disabled', `已关闭自动执行（${trigger}）`);
    return;
  }
  if (isDoneToday(state, today)) {
    await addLog('info', 'skipped_today', `今天已完成，跳过（${trigger}）`);
    return;
  }
  const delay = randomStartupDelayMinutes();
  await chrome.alarms.create(ALARM_RUN, { delayInMinutes: delay });
  await addLog('info', 'scheduled', `将在约 ${delay.toFixed(1)} 分钟后执行（${trigger}）`);
}

async function scheduleRetry(detail) {
  const state = await getState();
  const retryCount = Number(state.retryCount || 0) + 1;
  await patchState({ retryCount });
  if (retryCount > MAX_RETRY_PER_DAY) {
    await addLog('error', 'retry_exhausted', `今日重试已达上限（${MAX_RETRY_PER_DAY} 次），停止重试`);
    await chrome.alarms.clear(ALARM_RETRY);
    return;
  }
  await chrome.alarms.create(ALARM_RETRY, { delayInMinutes: RETRY_PERIOD_MINUTES });
  await addLog('warn', 'retry_scheduled', `${detail || '执行失败'}；将在 ${RETRY_PERIOD_MINUTES} 分钟后重试（第 ${retryCount} 次）`);
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
      priority: 2
    });
  } catch (err) {
    /* ignore */
  }
}

/* ------------------------------ 执行一次任务 ------------------------------ */

function waitForReady(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(onMessage);
      clearInterval(poller);
      clearTimeout(timer);
      resolve(ok);
    };
    const onMessage = (msg, sender) => {
      if (msg && msg.type === MSG.READY && sender.tab && sender.tab.id === tabId) done(true);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    // 内容脚本可能在监听建立前就已 READY，这里额外轮询探活
    const poller = setInterval(() => {
      chrome.tabs.sendMessage(tabId, { type: MSG.PING }, (resp) => {
        void chrome.runtime.lastError;
        if (resp && resp.type === MSG.PONG) done(true);
      });
    }, 1000);
    const timer = setTimeout(() => done(false), timeoutMs);
  });
}

function probeFrame(tabId, frameId, config) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    setTimeout(() => done(null), PROBE_TIMEOUT_MS);
    try {
      chrome.tabs.sendMessage(tabId, { type: MSG.PROBE, config }, { frameId }, (resp) => {
        void chrome.runtime.lastError;
        done(resp || null);
      });
    } catch (err) {
      done(null);
    }
  });
}

/**
 * 在标签的所有框架里找出真正能看到会话列表的那一帧。
 * 抖音的 /chat?isPopup=1 页面可能把聊天渲染在 iframe 内。
 * 返回 { frameId, probe } 或 { frameId: null, probes }
 */
async function pickChatFrame(tabId, config, deadline) {
  let lastProbes = [];
  for (;;) {
    let frames = [];
    try {
      frames = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
    } catch (err) {
      frames = [];
    }
    const frameIds = frames.length > 0 ? frames.map((f) => f.frameId) : [0];
    // 主框架优先
    frameIds.sort((a, b) => a - b);

    const probes = [];
    for (const frameId of frameIds) {
      const probe = await probeFrame(tabId, frameId, config);
      if (!probe) continue;
      probes.push({ frameId, ...probe });
      if (probe.hasList && probe.nicknameCount > 0) return { frameId, probe };
    }
    lastProbes = probes.length > 0 ? probes : lastProbes;

    // 已确定是登录/验证问题，无需继续等
    const blocked = lastProbes.find((p) => p.login || p.captcha);
    if (blocked) return { frameId: null, probes: lastProbes, blocked };

    if (Date.now() >= deadline) return { frameId: null, probes: lastProbes };
    await new Promise((r) => setTimeout(r, FRAME_PROBE_INTERVAL_MS));
  }
}

/**
 * 执行一次。
 * @param {string} trigger 触发来源（写日志用）
 * @param {boolean} force  true = 忽略「今天已完成」（仅弹窗手动执行使用）
 */
async function runOnce(trigger, force = false) {
  if (await isRunInProgress()) {
    await addLog('info', 'run_skipped_busy', `已有任务在执行中（${trigger}）`);
    return;
  }

  // 跨天先把「今天已发过谁」的名单作废
  const dayState = await getState();
  if (dayState.lastLedgerDate !== todayKey()) {
    await clearSentLedger();
    await patchState({ lastLedgerDate: todayKey() });
  }

  // 自动触发时再确认一次「今天是否已经跑完了」。
  // alarm 有可能在任务成功之后才响（例如启动排定了闹钟、期间用户点了手动执行），
  // 少了这道闸门就会给同一批人发第二遍。
  if (!force) {
    const state = await getState();
    if (isDoneToday(state)) {
      await addLog('info', 'skipped_today', `今天已经跑完了，不重复执行（${trigger}）`);
      await chrome.alarms.clear(ALARM_RUN);
      await chrome.alarms.clear(ALARM_RETRY);
      return;
    }
  }

  await closeOrphanTab();
  await sessionSet({ runInProgress: Date.now() });
  await BADGE.running();
  await patchState({ lastRunAt: Date.now() });
  await addLog('info', 'run_start', `开始执行（${trigger}）`);

  /*
   * 注意：不再把「今天发过谁」下发给内容脚本当跳过依据。
   * 是否已发一律由内容脚本读页面聊天记录判定（页面才是真相）。
   * 本地记录只用来做统计展示（徽标数、设置页清单）。
   */
  const config = await getConfig();
  const urls = chatUrlCandidates(config);
  let tabId = null;

  try {
    // 依次尝试候选聊天页地址，直到某个地址的某个框架能看到会话列表
    let picked = null;
    let lastProbes = [];
    let usedUrl = null;

    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      if (tabId === null) {
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
        await sessionSet({ createdTabId: tabId });
      } else {
        await chrome.tabs.update(tabId, { url, active: false });
      }
      await addLog('info', 'chat_url_try', `尝试聊天页：${url}`);

      const ready = await waitForReady(tabId, HANDSHAKE_TIMEOUT_MS);
      if (!ready) {
        await addLog('warn', 'handshake_timeout', `内容脚本握手超时：${url}`);
        continue;
      }

      const result = await pickChatFrame(tabId, config, Date.now() + CHAT_READY_TIMEOUT_MS);
      if (result.frameId !== null) {
        picked = result;
        usedUrl = url;
        break;
      }
      lastProbes = result.probes || lastProbes;
      if (result.blocked) {
        // 未登录 / 验证码：换地址也没用，直接交给用户处理
        const blocked = result.blocked;
        const reason = blocked.captcha ? 'captcha' : 'not_logged_in';
        await handleOutcome(
          { kind: 'abort', payload: { reason, detail: (blocked.captcha || blocked.login || {}).text || url }, logs: [] },
          tabId
        );
        return;
      }
      await addLog('warn', 'chat_url_no_list', `该地址未找到会话列表：${url}`);
    }

    if (!picked) {
      await patchState({
        lastResult: {
          ok: false,
          kind: 'abort',
          reason: 'chat_page_unavailable',
          detail: '所有候选聊天页都未找到会话列表',
          diagnostics: { probes: lastProbes, tried: urls }
        }
      });
      await addLog('error', 'chat_page_unavailable', `已尝试 ${urls.length} 个地址，均未找到会话列表：` + urls.join(' / '));
      await BADGE.error();
      await chrome.alarms.clear(ALARM_RETRY);
      // 保留标签并切到前台，方便你确认页面实际长什么样
      try {
        const tab = await chrome.tabs.update(tabId, { active: true });
        if (tab && tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
      } catch (err) {
        /* ignore */
      }
      await sessionSet({ createdTabId: null });
      await notify('抖音续火花：找不到会话列表', '请在设置页确认「聊天页地址」，或复制诊断信息调整选择器');
      return;
    }

    await addLog('info', 'chat_frame_ready', `使用 ${usedUrl}（frame ${picked.frameId}，${picked.probe.nicknameCount} 个会话）`);
    await patchState({ lastGoodUrl: usedUrl });
    const outcome = await driveSession(tabId, config, picked.frameId);
    await handleOutcome(outcome, tabId);
  } catch (err) {
    if (tabId) await closeTab(tabId);
    await patchState({ lastResult: { ok: false, kind: 'error', detail: String(err && err.message) } });
    await addLog('error', 'run_error', String(err && err.message));
    await BADGE.error();
    await scheduleRetry('执行异常：' + String(err && err.message));
  } finally {
    await sessionSet({ runInProgress: null });
  }
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch (err) {
    /* ignore */
  }
  await sessionSet({ createdTabId: null });
}

// 建立长连接执行任务；心跳兼作 service worker 保活
function driveSession(tabId, config, frameId) {
  return new Promise((resolve) => {
    let settled = false;
    let port;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(timer);
      try {
        if (port) port.disconnect();
      } catch (err) {
        /* ignore */
      }
      resolve(outcome);
    };

    try {
      port = chrome.tabs.connect(tabId, frameId === undefined || frameId === null ? { name: 'spark' } : { name: 'spark', frameId });
    } catch (err) {
      resolve({ kind: 'error', detail: '无法连接内容脚本：' + String(err && err.message) });
      return;
    }

    const progressLogs = [];
    port.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === MSG.PING) return; // 内容脚本的保活心跳，收到即可
      if (msg.type === MSG.PROGRESS) {
        if (msg.log) progressLogs.push(msg.log);
        // 每发出一条就立刻落盘，即使任务中途崩掉也不会重复发
        if (msg.sentEntry && msg.sentEntry.avatar) {
          addSentEntries([msg.sentEntry]).catch(() => {});
        }
        return;
      }
      if (msg.type === MSG.DONE) {
        finish({ kind: 'done', payload: msg, logs: msg.logs || progressLogs });
        return;
      }
      if (msg.type === MSG.ABORT) {
        finish({ kind: 'abort', payload: msg, logs: msg.logs || progressLogs });
      }
    });
    port.onDisconnect.addListener(() => {
      finish({ kind: 'disconnected', detail: '内容脚本连接中断', logs: progressLogs });
    });

    const heartbeat = setInterval(() => {
      try {
        port.postMessage({ type: MSG.PING });
      } catch (err) {
        /* ignore */
      }
    }, PORT_HEARTBEAT_MS);
    const timer = setTimeout(() => finish({ kind: 'timeout', detail: '任务超时', logs: progressLogs }), SESSION_TIMEOUT_MS);

    port.postMessage({ type: MSG.RUN_SESSION, config });
  });
}

async function handleOutcome(outcome, tabId) {
  if (Array.isArray(outcome.logs) && outcome.logs.length > 0) await addLogs(outcome.logs);

  if (outcome.kind === 'done') {
    const p = outcome.payload || {};
    const sent = Number(p.sent || 0);
    // 同一天多次执行时累加，徽标反映的是「今天一共发了几个人」
    const ledger = await getSentLedger();
    await patchState({
      lastSuccessDate: todayKey(),
      lastLedgerDate: todayKey(),
      todaySentCount: ledger.entries.length || sent,
      retryCount: 0,
      lastResult: { ok: true, sent, skipped: Number(p.skipped || 0), failed: Number(p.failed || 0), details: p.details || [] }
    });
    await addLog('info', 'run_done', `本次发出 ${sent} 人，跳过 ${p.skipped || 0} 人，失败 ${p.failed || 0} 人`);
    await BADGE.success(ledger.entries.length || sent);
    await chrome.alarms.clear(ALARM_RETRY);
    await closeTab(tabId);
    return;
  }

  if (outcome.kind === 'abort') {
    const p = outcome.payload || {};
    const reason = p.reason || 'dom_mismatch';
    const hint = ABORT_REASON_TEXT[reason] || '需要人工处理';
    await patchState({
      lastResult: { ok: false, kind: 'abort', reason, detail: p.detail || hint, diagnostics: p.diagnostics || null }
    });
    await addLog('error', 'run_abort', `${hint}${p.detail ? '（' + p.detail + '）' : ''}`);
    await BADGE.error();
    await chrome.alarms.clear(ALARM_RETRY);
    // 不关闭标签：切到前台并聚焦窗口，交给用户处理
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (tab && tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true, drawAttention: true });
    } catch (err) {
      /* ignore */
    }
    await notify('抖音续火花需要你处理', hint);
    // 解除标签归属：这个标签已交给用户（可能正在登录/过验证），后续执行不再自动关闭它
    await sessionSet({ createdTabId: null });
    return;
  }

  /*
   * timeout / disconnected / error：一般性失败。
   * 注意：断线前可能已经发出去一些人（sentEntry 是实时落盘的），
   * 这些人今天不该再被打扰。重试时页面判定会兜住（读聊天记录就知道已聊过），
   * 所以这里只需把已发数量记进徽标，不要清零。
   */
  const partial = await getSentLedger();
  if (partial.entries.length > 0) {
    await patchState({ todaySentCount: partial.entries.length });
    await addLog('info', 'partial_progress', `中断前已发出 ${partial.entries.length} 人，重试时会自动跳过他们`);
  }
  const detail = outcome.detail || '执行未完成';
  await patchState({ lastResult: { ok: false, kind: outcome.kind, detail } });
  await addLog('error', 'run_failed', detail);
  await BADGE.error();
  await closeTab(tabId);
  await scheduleRetry(detail);
}

/* ------------------------------ 事件绑定 ------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  scheduleDailyRun('安装/更新').catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  closeOrphanTab()
    .then(() => scheduleDailyRun('浏览器启动'))
    .catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_RUN) {
    runOnce('定时触发').catch(() => {});
    return;
  }
  if (alarm.name === ALARM_RETRY) {
    getState()
      .then((state) => {
        if (isDoneToday(state)) return chrome.alarms.clear(ALARM_RETRY);
        return runOnce('失败重试');
      })
      .catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === MSG.GET_STATE) {
    Promise.all([getConfig(), getState(), getLogs(), isRunInProgress()])
      .then(([config, state, logs, busy]) => {
        sendResponse({ config, state, logs: logs.slice(-40).reverse(), busy, today: todayKey() });
      })
      .catch((err) => sendResponse({ error: String(err && err.message) }));
    return true;
  }

  if (msg.type === MSG.MANUAL_RUN) {
    isRunInProgress()
      .then((busy) => {
        if (busy) {
          sendResponse({ ok: false, error: '已有任务在执行中' });
          return null;
        }
        sendResponse({ ok: true });
        return runOnce('手动执行', true);
      })
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message) }));
    return true;
  }

  if (msg.type === MSG.CONFIG_UPDATED) {
    chrome.alarms
      .clear(ALARM_RUN)
      .then(() => scheduleDailyRun('配置更新'))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message) }));
    return true;
  }

  if (msg.type === MSG.CLEAR_SENT_LEDGER) {
    clearSentLedger()
      .then(() => patchState({ lastLedgerDate: todayKey(), lastSuccessDate: null }))
      .then(() => addLogs([makeLogEntry('info', 'ledger_cleared', '已清空「今天发过谁」的记录，下次执行会重新发一遍')]))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message) }));
    return true;
  }

  if (msg.type === MSG.GET_SENT_LEDGER) {
    getSentLedger()
      .then((ledger) => sendResponse({ ok: true, ledger }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message) }));
    return true;
  }

  if (msg.type === MSG.CLEAR_LOGS) {
    clearLogs()
      .then(() => addLogs([makeLogEntry('info', 'logs_cleared', '日志已清空')]))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message) }));
    return true;
  }

  return false;
});