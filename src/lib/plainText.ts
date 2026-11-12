/** Named entities the supplier's text uses; numeric ones are decoded generally. Seen live: "Unique &amp; Different". */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó', uacute: 'ú', iacute: 'í', ntilde: 'ñ', ccedil: 'ç', euro: '€' };
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}
/** Supplier HTML to plain text: tags become breaks between paragraphs, entities are decoded, nothing is interpreted. */
export const plain = (html: string | null) =>
  html
    ? decodeEntities(html.replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' '))
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
    : null;
