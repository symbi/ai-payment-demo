import { isRecord } from './policy.ts';
export class InputError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function requestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) throw new InputError('requestId 须为 8–80 位字母、数字、下划线或连字符');
  return value;
}
export function inspectInput(value: unknown): { requestId: string; prompt: string } {
  if (!isRecord(value) || Object.keys(value).some(key => !['requestId', 'prompt'].includes(key))) throw new InputError('仅接受 requestId 与 prompt，不接受网址、付款条件或 allow 标志');
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 500) throw new InputError('请填写 1–500 字的任务说明');
  return { requestId: requestId(value.requestId), prompt: value.prompt };
}
export function payInput(value: unknown): string {
  if (!isRecord(value) || Object.keys(value).some(key => key !== 'requestId')) throw new InputError('付款检查仅接受已存在的 requestId');
  return requestId(value.requestId);
}
