import { expect, test } from '../fixtures/test';

/**
 * The second language (docs/i18n.md): switch to Spanish with the picker, run a
 * search with the pills (no typed words, so no model call), and see the
 * screen, Penny's lines, the place names from the supplier, a chip edit and a
 * reload all in Spanish. Then back to English.
 */
test('switch to Spanish and search Oporto', { tag: ['@ui'] }, async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('./?detail=slideout');
  await expect(page.getByRole('heading', { name: 'Not 400 hotels. The right one, and why.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // The picker names each language in itself.
  const picker = page.getByRole('combobox', { name: /Language/ });
  await expect(picker.locator('option')).toHaveText(['English', 'Español']);
  await picker.selectOption('es');

  await expect(page.getByRole('heading', { name: 'No 400 hoteles. El adecuado, y por qué.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  const trips = page.getByRole('navigation', { name: 'Tus viajes' });
  await expect(trips.getByText('Una búsqueda aparece aquí en cuanto tiene lugar y fechas.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cuándo: Esta noche · 1 noche' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quién: 2 adultos' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Respuesta de ejemplo' })).toContainText('Ejemplo de una búsqueda real: Oporto, 2 noches, precio bajo y buenas opiniones');
  await page.screenshot({ path: 'test-results/es-00-first-screen.png' });

  // The place, as the supplier names it in Spanish, with its kind in Spanish.
  await page.getByLabel('Tu viaje', { exact: true }).fill('oporto');
  const oporto = page.getByRole('button', { name: /^Oporto\s*Portugal · Ciudad$/ });
  await expect(oporto).toBeVisible();
  await oporto.click();
  await expect(page.getByRole('button', { name: /^Dónde: Oporto, Portugal/ })).toBeVisible();

  // Next weekend, in the Spanish calendar.
  await page.getByRole('button', { name: /^Cuándo:/ }).click();
  const nightsCard = page.getByRole('dialog', { name: 'Elige tus noches' });
  await expect(nightsCard.getByRole('grid')).toHaveCount(2);
  await page.getByRole('button', { name: 'El próximo fin de semana' }).click();
  await expect(nightsCard).toContainText(/vie.* – dom.* · 2 noches/);
  await page.getByRole('button', { name: 'Hecho' }).click();
  await expect(page.getByRole('button', { name: /^Cuándo: .* · 2 noches$/ })).toBeVisible();

  await page.getByRole('button', { name: 'Precio bajo' }).click();
  await page.getByRole('button', { name: 'Buscar mi hotel' }).click();

  // The first search, said in Spanish; the cards in Spanish with prices in the Spanish form.
  await expect(page.getByText(/\d+ de \d+ hoteles encajan\. Aparecen los \d mejores/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Hola, soy Penny.', { exact: false }).first()).toBeVisible();
  const cards = page.locator('ol > li');
  await expect(cards).toHaveCount(5);
  await expect(cards.first()).toContainText('El más barato disponible');
  await expect(cards.first()).toContainText(/\d\s€/); // Intl puts a no-break space before the sign
  await expect(cards.first()).toContainText(/total por 2 noches/);
  await expect(cards.first().getByRole('button', { name: 'Reservar' })).toBeVisible();
  await expect(cards.nth(1)).toContainText('Frente al primero:');
  await expect(page.getByRole('button', { name: 'Cambiar lo que más te importa' })).toHaveText('Precio bajo ✎');
  await expect(page.getByLabel('Nacionalidad para las tarifas')).toBeVisible();
  await expect(page.getByLabel('Mensaje')).toHaveAttribute('placeholder', 'Pregunta a Penny, o cambia la búsqueda');
  // Nothing on the way here was left in English.
  await expect(page.getByText(/hotels fit|Find my hotel|Your trips|Cheapest available|total for/)).toHaveCount(0);
  await page.screenshot({ path: 'test-results/es-01-shortlist.png' });

  // A chip edit: the line the chat gets is Spanish too.
  await page.getByRole('button', { name: 'Cambiar quién' }).click();
  await page.getByRole('dialog', { name: 'Cambiar quién' }).getByRole('button', { name: 'Más adultos' }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByRole('button', { name: 'Cambiar quién' })).toHaveText(/3 adultos/, { timeout: 60_000 });
  const convo = page.getByRole('region', { name: 'Conversación' });
  // The line says what changed; the count of hotels that fit is not repeated (the list shows them: Sam, 2026-11-13).
  await expect(convo.getByText(/^3 adultos\.$/).last()).toBeVisible();

  // The choice is remembered: a reload is still in Spanish.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nueva búsqueda' })).toBeVisible();
  // How many fit three adults depends on today's sandbox: the cards say it in Spanish either way.
  await expect(page.getByRole('button', { name: 'Cambiar quién' })).toHaveText(/3 adultos/);
  await expect(page.getByRole('region', { name: 'Hoteles' })).toContainText(/El más barato disponible|Nada lo cumple todo|Casi, pero/);

  // And back to English: the screen follows at once; lines already said stay as they were.
  await page.getByRole('combobox', { name: /Idioma/ }).selectOption('en');
  await expect(page.getByRole('button', { name: 'New search' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change who' })).toHaveText(/3 adults/);
  await expect(page.getByRole('region', { name: 'Hotels' })).toContainText(/Cheapest available|Nothing fits everything|Close, but/);
  await expect(page.getByRole('region', { name: 'Conversation' }).getByText(/^3 adultos\.$/).last()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  expect(errors).toEqual([]);
});

/**
 * "Madrid, España" typed in Spanish (2026-11-14): the words say which Madrid,
 * so it is searched at once, never "¿Cuál?" against Plaza de España in Madrid.
 * No model here: with no scan, the box's words are the place looked up.
 * (The first message's country kept when the place is retyped needs the scan:
 * src/test/pg/turn.test.ts.)
 */
for (const phone of [false, true]) {
  test(`a place with its country is searched, not asked${phone ? ' (phone)' : ''}`, { tag: ['@ui'] }, async ({ page }) => {
    await page.goto('./');
    // The picker is in the sidebar, which a phone keeps under its Trips tab: chosen first, then the phone.
    await page.getByRole('combobox', { name: /Language/ }).selectOption('es');
    if (phone) await page.setViewportSize({ width: 390, height: 780 });
    await expect(page.getByRole('heading', { name: 'No 400 hoteles. El adecuado, y por qué.' })).toBeVisible();

    await page.getByLabel('Tu viaje', { exact: true }).fill('Madrid, España');
    await page.getByRole('button', { name: 'Buscar mi hotel' }).click();

    // A phone opens on its Hotels tab once the hotels are in: Penny's lines are under Chat.
    if (phone) {
      // The tab bar's own name is not translated yet ("View"): found by its tabs instead.
      const tabs = page.getByRole('tablist');
      await expect(tabs.getByRole('tab', { name: /^Hoteles \(\d+\)$/ })).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
      await tabs.getByRole('tab', { name: 'Chat' }).click();
    }
    await expect(page.getByText('Buscando en Madrid, España.', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('¿Cuál?', { exact: true })).toHaveCount(0);
    await expect(page.getByText('La búsqueda de lugares no ha respondido', { exact: false })).toHaveCount(0);
  });
}
