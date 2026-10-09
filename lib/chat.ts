/** 对话面板的按键约定：回车发送，Shift + 回车换行。 */
export type ChatKeyEvent = {
  key: string;
  shiftKey: boolean;
  /** 中文输入法组词时浏览器会带上这个标记，此时回车是确认候选词，不能当成发送。 */
  isComposing?: boolean;
  keyCode?: number;
};

export function shouldSendOnEnter(event: ChatKeyEvent): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  if (event.isComposing || event.keyCode === 229) return false;
  return true;
}
