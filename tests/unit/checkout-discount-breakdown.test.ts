import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync('apps/shopify-admin/public/checkout/checkout.js', 'utf8');
const totalsSource = source.slice(
  source.indexOf('  function applyTotals('),
  source.indexOf('  function paintUpsellRail('),
);
const toggleSource = source.slice(
  source.indexOf("      if (target.closest('#ec-discount-label'))"),
  source.indexOf("      if (target.closest('[data-ec-close]')"),
);

function render(coupons: Array<{ code: string; discountMinor: number; kind?: string }>) {
  return runInNewContext(
    `
    const nodes = new Map();
    const $ = id => {
      if (!nodes.has(id)) nodes.set(id, {hidden:false, textContent:'', innerHTML:'', disabled:false,
        attributes:{}, children:[{}], classList:{add(){}}, setAttribute(k,v){this.attributes[k]=v;},
        replaceChildren(){this.innerHTML='';this.children=[];}});
      return nodes.get(id);
    };
    const currentSession = { coupons, coupon:{code:coupons.map(c=>c.code).join(' + '), discountMinor:71675} };
    const appliedCouponCode = ''; let basePayMinor=0;
    const currentUpiConfig=null;
    const document={querySelector:()=>null};
    const lineUnitMinor=line=>line.unitAmount.amountMinor;
    const formatInr=value=>'₹'+(value/100).toFixed(2);
    const escHtml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const syncFreeShippingBadge=()=>{};const setCompareDisplay=()=>{};const refreshPaymentAmounts=()=>{};
    ${totalsSource}
    applyTotals({subtotalMinor:435500,discountMinor:71675,shippingMinor:0,amountMinor:363825},[]);
    const initialHidden=$('ec-discount-breakdown').hidden;
    const initialExpanded=$('ec-discount-label').attributes['aria-expanded'];
    const target={closest:selector=>selector==='#ec-discount-label'};
    function click(){${toggleSource}}
    click();const expanded=!$('ec-discount-breakdown').hidden && $('ec-discount-label').attributes['aria-expanded']==='true';
    click();const collapsed=$('ec-discount-breakdown').hidden && $('ec-discount-label').attributes['aria-expanded']==='false';
    ({initialHidden,initialExpanded,expanded,collapsed,html:$('ec-discount-items').innerHTML,total:$('ec-discount').textContent});
  `,
    { coupons },
  ) as {
    initialHidden: boolean;
    initialExpanded: string;
    expanded: boolean;
    collapsed: boolean;
    html: string;
    total: string;
  };
}

describe('coupon breakdown', () => {
  it('starts collapsed, lists each code and saving, and toggles both ways', () => {
    const result = render([
      { code: 'CYR50', discountMinor: 49900 },
      { code: 'Test5', discountMinor: 21775 },
    ]);
    expect(result).toMatchObject({
      initialHidden: true,
      initialExpanded: 'false',
      expanded: true,
      collapsed: true,
      total: '−₹716.75',
    });
    expect(result.html).toContain('CYR50</dt><dd>−₹499.00');
    expect(result.html).toContain('Test5</dt><dd>−₹217.75');
  });
  it('escapes coupon text and includes free-shipping offers', () => {
    const result = render([
      { code: '<img onerror=alert(1)>', discountMinor: 71675 },
      { code: 'SHIP', kind: 'free_shipping', discountMinor: 0 },
    ]);
    expect(result.html).not.toContain('<img');
    expect(result.html).toContain('&lt;img');
    expect(result.html).toContain('SHIP</dt><dd>Free shipping');
  });
});
