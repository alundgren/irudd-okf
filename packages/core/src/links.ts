// Browser and file engine use the same bundle-relative link resolution.
export function resolveLinkTarget(source: string, href: string): { target: string; external: boolean; fragment?: string; unsafe?: boolean } {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return { target: href, external: true };
  const separator = href.search(/[?#]/);
  const destination = separator < 0 ? href : href.slice(0, separator);
  const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(destination); } catch { return { target: href, external: false, unsafe: true, fragment }; }
  if (decoded.includes('\\') || decoded.includes('\0')) return { target: href, external: false, unsafe: true, fragment };
  const relative = decoded.startsWith('/') ? decoded.slice(1) : source.slice(0, source.lastIndexOf('/') + 1) + decoded;
  const parts: string[] = [];
  for (const part of relative.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else parts.push(part);
  }
  let target = decoded ? parts.join('/') || '.' : source;
  const unsafe = target === '..' || target.startsWith('../');
  if (target === '.') target = 'index.md';
  else if (decoded.endsWith('/')) target = target.replace(/\/$/, '') + '/index.md';
  return { target, external: false, fragment, unsafe };
}
