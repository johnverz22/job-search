import { describe, expect, it } from 'vitest';
import { sanitizeDescription } from '../src/lib/sanitize';
import { safeHttpUrl } from '../src/lib/url';

const render = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = sanitizeDescription(html);
  return host;
};

describe('sanitizeDescription: hostile input', () => {
  // Classic and mutation-XSS payloads; none may leave an executable element, handler or script URL behind.
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<svg><script>alert(1)</script></svg>',
    '<a href="javascript:alert(1)">x</a>',
    '<a href=" jav&#x09;ascript:alert(1)">x</a>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<iframe src="https://evil.example"></iframe>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<object data="x"></object><embed src="x">',
    '<form action="https://evil.example"><input name=p><button>go</button></form>',
    '<p onclick="alert(1)" onmouseover="alert(2)">hi</p>',
    '<div style="background:url(javascript:alert(1))">x</div>',
    '<style>@import "https://evil.example/x.css"; body{display:none}</style>',
    '<link rel=stylesheet href="https://evil.example/x.css">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<base href="https://evil.example/">',
    '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<details open ontoggle=alert(1)>',
    '<body onload=alert(1)>',
    '<p>text<!--[if IE]><script>alert(1)</script><![endif]--></p>',
    '"><script>alert(1)</script>',
  ];
  it.each(payloads)('neutralizes %s', (payload) => {
    const host = render(payload);
    const html = host.innerHTML.toLowerCase();
    expect(host.querySelector('script,iframe,object,embed,form,input,button,style,link,meta,base,img,svg,math,noscript,details')).toBeNull();
    expect(html).not.toMatch(/\son[a-z]+\s*=/);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text');
    for (const el of host.querySelectorAll('*')) expect(el.hasAttribute('style'), el.outerHTML).toBe(false);
  });

  it('keeps the formatting job descriptions rely on', () => {
    const host = render('<h2>About</h2><p>We <strong>build</strong> <em>things</em>.</p><ul><li>One</li><li>Two</li></ul><table><tbody><tr><td colspan="2">x</td></tr></tbody></table>');
    expect(host.querySelector('h2')?.textContent).toBe('About');
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.querySelector('td')?.getAttribute('colspan')).toBe('2');
    expect(host.querySelector('strong')?.textContent).toBe('build');
  });

  it('forces safe link attributes and keeps only http(s)/mailto hrefs', () => {
    const host = render('<a href="https://ok.example/p" target="_self" rel="opener">a</a><a href="mailto:hr@ok.example">m</a><a href="/relative">r</a><a href="ftp://x">f</a>');
    const [a, m, r, f] = [...host.querySelectorAll('a')];
    expect(a!.getAttribute('href')).toBe('https://ok.example/p');
    for (const link of [a!, m!, r!, f!]) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    }
    expect(r!.hasAttribute('href')).toBe(false);
    expect(f!.hasAttribute('href')).toBe(false);
  });

  it('strips classes, ids and data/aria attributes', () => {
    const host = render('<p class="x" id="y" data-a="1" aria-hidden="true">t</p>');
    expect(host.querySelector('p')!.attributes).toHaveLength(0);
  });

  it('handles empty and plain-text input', () => {
    expect(sanitizeDescription(null)).toBe('');
    expect(sanitizeDescription('')).toBe('');
    expect(sanitizeDescription('just text <b>b</b>')).toBe('just text <b>b</b>');
  });

  it('escapes instead of executing text that only looks like markup', () => {
    expect(sanitizeDescription('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('safeHttpUrl', () => {
  it.each([
    ['https://a.example/x?y=1', 'https://a.example/x?y=1'], ['http://a.example/', 'http://a.example/'],
    ['javascript:alert(1)', null], ['data:text/html,x', null], ['//a.example', null], ['/rel', null], ['', null], [null, null], ['not a url', null], ['file:///etc/passwd', null],
  ])('%s', (input, out) => expect(safeHttpUrl(input as string | null)).toBe(out));
});
