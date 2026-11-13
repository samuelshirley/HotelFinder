/**
 * Every interactive control on screen, as `role "accessible name"`: buttons,
 * links, [role=button|tab|separator|checkbox], inputs, selects, textareas and
 * <summary>. Hidden controls are left out (they are listed in the state that
 * shows them). The coverage registry (e2e/guards/registry.ts) claims each one
 * for a test; e2e/guards/controls.spec.ts fails on any control no claim
 * matches, so a new button cannot ship untested.
 */
import type { Page } from '@playwright/test';

export type Control = { key: string; role: string; name: string };

export async function inventory(page: Page): Promise<Control[]> {
  const found = await page.evaluate(() => {
    const SELECTOR = 'button, a[href], [role="button"], [role="tab"], [role="checkbox"], [role="separator"][tabindex], input, select, textarea, summary';
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const s = getComputedStyle(el as HTMLElement);
      if (s.visibility === 'hidden' || s.display === 'none') return false;
      return !(el as HTMLElement).closest('[hidden], [inert]');
    };
    const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    const labelled = (el: Element) => {
      const ids = el.getAttribute('aria-labelledby');
      if (ids) return ids.split(/\s+/).map((id) => text(document.getElementById(id) ?? document.createElement('i'))).join(' ');
      return '';
    };
    const name = (el: Element): string => {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      const by = labelled(el);
      if (by) return by;
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        const label = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
        if (label) {
          // The label's own words, without the text of the control inside it (a <select>'s options).
          const clone = label.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('select, input, textarea').forEach((c) => c.remove());
          return text(clone);
        }
        return el.getAttribute('placeholder') ?? el.getAttribute('name') ?? '';
      }
      return text(el) || el.getAttribute('title') || '';
    };
    const role = (el: Element): string => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'summary') return 'summary';
      if (tag === 'input') {
        const t = (el as HTMLInputElement).type;
        return t === 'checkbox' ? 'checkbox' : t === 'radio' ? 'radio' : t === 'hidden' ? 'hidden' : 'textbox';
      }
      return tag;
    };
    return [...document.querySelectorAll(SELECTOR)]
      .filter(visible)
      .filter((el) => role(el) !== 'hidden')
      .map((el) => ({ role: role(el), name: name(el) }));
  });
  return found.map((c) => ({ ...c, key: `${c.role} "${c.name}"` }));
}
