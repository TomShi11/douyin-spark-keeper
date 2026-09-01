// 扩展内部消息类型常量（后台 <-> 内容脚本 <-> 弹窗/选项页）
export const MSG = {
  // 内容脚本 -> 后台：内容脚本已就绪
  READY: 'READY',
  // 后台 -> 内容脚本：探活
  PING: 'PING',
  PONG: 'PONG',
  // 后台 -> 内容脚本：探测该框架能否看到会话列表（含诊断信息）
  PROBE: 'PROBE',
  // 后台 -> 内容脚本（长连接）：开始一次续火花任务
  RUN_SESSION: 'RUN_SESSION',
  // 内容脚本 -> 后台（长连接）：单个会话处理进度
  PROGRESS: 'PROGRESS',
  // 内容脚本 -> 后台（长连接）：任务正常结束
  DONE: 'DONE',
  // 内容脚本 -> 后台（长连接）：任务中止（需要人工处理）
  ABORT: 'ABORT',
  // 弹窗 -> 后台：立即执行一次
  MANUAL_RUN: 'MANUAL_RUN',
  // 弹窗/选项页 -> 后台：读取状态
  GET_STATE: 'GET_STATE',
  // 选项页 -> 后台：配置已更新，重新评估调度
  CONFIG_UPDATED: 'CONFIG_UPDATED',
  // 弹窗/选项页 -> 后台：清空日志
  CLEAR_LOGS: 'CLEAR_LOGS',
  // 设置页 -> 后台：清空「今天已经发过谁」的记录（用于重新发一遍）
  CLEAR_SENT_LEDGER: 'CLEAR_SENT_LEDGER',
  // 设置页 -> 后台：读取「今天已经发过谁」
  GET_SENT_LEDGER: 'GET_SENT_LEDGER'
};

// ABORT 原因
export const ABORT_REASON = {
  NOT_LOGGED_IN: 'not_logged_in',
  CAPTCHA: 'captcha',
  DOM_MISMATCH: 'dom_mismatch',
  CHAT_PAGE_UNAVAILABLE: 'chat_page_unavailable'
};

export const ABORT_REASON_TEXT = {
  not_logged_in: '抖音没登录。已经把页面切到前台了，登录一下再点「立即执行一次」',
  captcha: '抖音弹了安全验证。已经把页面切到前台了，过完验证再点「立即执行一次」',
  dom_mismatch: '页面认不出来了，抖音大概是改版了。可以到设置页看「诊断信息」并调整选择器',
  chat_page_unavailable: '打不开聊天页，或者页面上没有会话列表。请到设置页确认「聊天页地址」'
};

export const MSG_LIST = Object.keys(MSG);
