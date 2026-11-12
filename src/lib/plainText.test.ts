import { describe, expect, it } from 'vitest';

import { decodeEntities, plain } from './plainText';

describe('supplier text to plain text', () => {
  it('decodes the entities the supplier sends (seen live: "Unique &amp; Different")', () => {
    expect(decodeEntities('Hotel Mio Vallarta Unique &amp; Different')).toBe('Hotel Mio Vallarta Unique & Different');
    expect(decodeEntities('caf&eacute; &#233; &#xE9; &unknown;')).toBe('café é é &unknown;');
  });

  it('keeps paragraphs as lines and drops every tag', () => {
    expect(plain('<p><strong>Rooms</strong><br>Big &amp; bright.</p><p>Pool <em>open</em>.</p>')).toBe('Rooms\nBig & bright.\nPool open .');
    expect(plain('<script>alert(1)</script>')).toBe('alert(1)');
    expect(plain(null)).toBeNull();
  });
});
