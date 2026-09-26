import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PayAssessmentDemo } from '../../../apps/web/src/PayAssessmentDemo.tsx';

it('keeps the three existing panels and the simulation boundary in offline SSR', () => {
  const html = renderToStaticMarkup(createElement(PayAssessmentDemo));
  for (const title of ['钱包与额度', '订单与收款方', '决定与原因', '纯演示·无真实付款', '模拟钱包', '真实余额未读取']) expect(html).toContain(title);
  expect(html).toContain('模拟请求情景');
  expect(html).toContain('延迟返回（约 1 秒）');
  expect(html).toContain('结果未确认');
  expect(html).toContain('服务器重启丢失记录时保持未确认');
  expect(html).toContain('不是实际付款幂等保证');
  for (const title of ['模拟请求情景', '查看评分权重与各项原因']) {
    const details = html.match(new RegExp(`<details[^>]*><summary>${title}</summary>`));
    expect(details).not.toBeNull(); expect(details![0]).not.toMatch(/\bopen/);
  }
  expect(html).toContain('value="40"'); expect(html).toContain('value="25"'); expect(html).toContain('value="15"');
  expect(html).not.toContain('本次演示决定');
});
