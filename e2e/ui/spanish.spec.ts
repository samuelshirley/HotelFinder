import type { Page } from '@playwright/test';

import { expect, openSession, test } from '../fixtures/test';
import { ORIGIN, uniqueEmail } from '../support/env';

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

/** Answer the checkout page's GET of its booking with the real answer changed by `patch`: a receipt without booking anything. */
async function asIf(page: Page, patch: Record<string, unknown>) {
  await page.unroute(/\/api\/booking\/[0-9a-f-]{36}$/);
  await page.route(/\/api\/booking\/[0-9a-f-]{36}$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, booking: { ...body.booking, ...patch } } });
  });
  await page.reload();
}

/**
 * The hotel page and the checkout in Spanish (docs/i18n.md, 2026-11-14), at
 * desktop and phone size: a hotel opened from the shortlist, its photos, its
 * price and cancellation, its questions; then Reservar, the sign-in, and the
 * checkout up to the test wallet's sheet, which is cancelled: the sandbox
 * books nothing here. The frozen and receipt states are the same page with
 * the booking's state answered as it would be after each step.
 */
for (const phone of [false, true]) {
  test(`a hotel and its checkout, in Spanish${phone ? ' (phone)' : ''}`, { tag: ['@ui', '@booking'] }, async ({ page, context, searched }) => {
    test.setTimeout(240_000);
    await context.addCookies([{ name: 'hf_locale', value: 'es', domain: new URL(ORIGIN).hostname, path: '/' }]);
    if (phone) await page.setViewportSize({ width: 390, height: 780 });
    await openSession(page, searched.sessionId, '?detail=slideout');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    if (phone) {
      const hotels = page.getByRole('tab', { name: /^Hoteles \(\d+\)$/ });
      await expect(hotels).toBeVisible({ timeout: 60_000 });
      await hotels.click();
    }
    const card = page.locator('ol > li').filter({ has: page.getByRole('button', { name: 'Reservar', exact: true }) }).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    const hotel = (await card.getByRole('heading', { level: 3 }).textContent())!.replace(/^\s*\d+\s*/, '').trim();
    await card.getByRole('button', { name: 'Detalles', exact: true }).click();

    // The hotel, opened: every heading, label and line is Spanish.
    const panel = page.getByRole('dialog').filter({ has: page.getByRole('region', { name: 'Precio' }) });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Cargando el hotel…')).toHaveCount(0, { timeout: 60_000 });
    const price = panel.getByRole('region', { name: 'Precio' });
    await expect(price).toContainText(/\d\s€ en total/);
    await expect(price).toContainText(/\d+ noches? × .+ · impuestos y tasas incluidos/);
    await expect(price).toContainText(/No reembolsable|Cancelación gratuita/);
    await expect(price.getByRole('button', { name: /^Reservar · .+€$/ })).toBeVisible();
    await expect(panel.getByRole('list', { name: 'Datos clave' })).toBeVisible();
    const faq = panel.getByRole('region', { name: 'Preguntas sobre este hotel' });
    await expect(faq).toContainText('¿Cuánto cuesta en estas fechas?');
    await expect(faq).toContainText('¿Puedo cancelar gratis?');
    await expect(faq).toContainText('¿A qué hora es la entrada?');
    await expect(faq).toContainText('Respondidas con el anuncio del hotel y esta tarifa.');
    await expect(faq).toContainText(new RegExp(`${hotel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: .+ por \\d+ noches?, .+ por noche`));

    // The photos, if the listing has any: the lightbox and its buttons are named in Spanish.
    const photo = panel.getByRole('button', { name: /^Foto 1 de \d+$/ });
    if ((await photo.count()) > 0) {
      await photo.first().click();
      const lightbox = page.getByRole('dialog', { name: `Fotos de ${hotel}` });
      await expect(lightbox).toBeVisible();
      await expect(lightbox.getByRole('img', { name: new RegExp(`foto 1 de \\d+$`) })).toBeVisible();
      await lightbox.getByRole('button', { name: 'Foto siguiente' }).click();
      await expect(lightbox.getByRole('img', { name: new RegExp(`foto 2 de \\d+$`) })).toBeVisible();
      await expect(lightbox.getByRole('button', { name: 'Foto anterior' })).toBeVisible();
      await lightbox.getByRole('button', { name: 'Cerrar las fotos' }).click();
      await expect(lightbox).toHaveCount(0);
    }
    // Nothing of ours on the hotel page was left in English: no heading, button, label or line. The
    // supplier's own words stay as it sends them (review points, room and board names: docs/i18n.md).
    for (const name of ['Price', 'Cancellation', 'Questions about this hotel']) await expect(panel.getByRole('region', { name, exact: true })).toHaveCount(0);
    await expect(panel.getByRole('list', { name: 'Key facts' })).toHaveCount(0);
    await expect(panel.getByRole('heading', { name: /^(Location|Amenities|About|Good to know|What guests say|Guests liked|Watch out for|Rooms & rates)$/ })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^(Book · |Select$|Retry$|Read more$|Show |Collapse|Photo \d)/ })).toHaveCount(0);
    await expect(panel.getByRole('link', { name: 'Open in Maps' })).toHaveCount(0);
    await expect(panel.getByText(/taxes & fees included|paid at the hotel|^✓ Free cancellation|^✕ Non-refundable|No price for these dates|summary from the supplier|How much is it|Answered from the hotel/)).toHaveCount(0);
    // Spanish runs longer than English: nothing pushes the page sideways (docs/testing.md, the hunt's step 2).
    if (phone) expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `test-results/es-02-hotel${phone ? '-phone' : ''}.png` });

    // Reservar: signed out, the sign-in comes first, in Spanish.
    await price.getByRole('button', { name: /^Reservar · / }).click();
    const modal = page.getByRole('dialog', { name: 'Inicia sesión para reservar' });
    await expect(modal).toBeVisible();
    await modal.getByLabel(/^Correo electrónico\./).fill(uniqueEmail('es-book'));
    await modal.getByRole('button', { name: 'Enviar código' }).click();
    const devCode = modal.getByRole('status').filter({ hasText: 'Aquí no hay servicio de correo' });
    await expect(devCode).toBeVisible();
    await modal.getByLabel(/^El código de 6 dígitos enviado a /).fill((await devCode.locator('strong').textContent())!.trim());
    await expect(modal).toHaveCount(0, { timeout: 90_000 });
    await expect(page).toHaveURL(/\/hotels\/book\/[0-9a-f-]{36}$/, { timeout: 60_000 });

    // The checkout.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    const stay = page.getByRole('region', { name: 'Tu estancia' });
    await expect(stay.getByRole('heading', { name: hotel })).toBeVisible({ timeout: 60_000 });
    await expect(stay).toContainText(/ · \d+ noches? · \d+ adultos?/);
    await expect(stay.locator('dt').filter({ hasText: /^A pagar ahora, impuestos incluidos$/ })).toBeVisible();
    await expect(stay.locator('dt').filter({ hasText: /^Cancelación$/ }).locator('+ dd')).toHaveText(/^(No reembolsable|Gratis hasta el .+ UTC|Reembolsable; el hotel no ha dado el plazo|El hotel no lo indica)$/);
    await expect(stay).toContainText(/Precio comprobado con el hotel ahora mismo|El precio ha cambiado/);
    await expect(stay.getByRole('group', { name: 'A pagar en el hotel' }).or(stay.locator('dt').filter({ hasText: /^A pagar en el hotel$/ }))).toBeVisible();
    const form = page.getByRole('region', { name: 'Iniciar sesión y pagar' });
    await expect(form.getByRole('heading', { name: 'Resérvalo' })).toBeVisible();
    await expect(form).toContainText(/Sesión iniciada como .+ · ¿No eres tú\?/);
    await expect(form.getByLabel('Peticiones especiales (opcional)')).toHaveAttribute('placeholder', 'Una habitación tranquila, una llegada tarde, una cuna…');
    await expect(form).toContainText('Se envían al hotel con tu reserva. Las peticiones no están garantizadas.');
    await expect(form).toContainText('Pagos de prueba: los monederos de abajo son una simulación y no se mueve dinero.');
    await expect(page.getByRole('link', { name: '← Volver a la selección' })).toBeVisible();
    const freeze = form.getByRole('group', { name: 'Congelar este precio' });
    if ((await freeze.count()) > 0) {
      await expect(freeze.getByRole('heading', { name: '¿Aún no lo tienes claro? Congélalo, gratis' })).toBeVisible();
      await expect(freeze.getByRole('button', { name: /^Congelar hasta el .+ UTC$/ })).toBeVisible();
    }

    // A press without names says so in Spanish; then the test wallet's sheet, cancelled: nothing is booked.
    await form.getByLabel('Nombre (como en el documento del huésped)').fill('');
    await form.getByRole('button', { name: /^Pagar .+ con Apple Pay$/ }).click();
    await expect(form.getByText('Añade el nombre y los apellidos del huésped como en su documento.')).toBeVisible();
    await form.getByLabel('Nombre (como en el documento del huésped)').fill('Ana');
    await form.getByLabel('Apellidos', { exact: true }).fill('Silva');
    await form.getByRole('button', { name: /^Pagar .+ con Apple Pay$/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Apple Pay (prueba)' });
    await expect(sheet).toContainText('PRUEBA · no se mueve dinero');
    await expect(sheet).toContainText('Tarjeta de prueba •••• 4242');
    await expect(sheet).toContainText(`Buscador de hoteles · ${hotel}`);
    await expect(sheet.getByRole('button', { name: /^Confirmar .+€$/ })).toBeVisible();
    if (phone) expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `test-results/es-03-checkout${phone ? '-phone' : ''}.png` });
    await sheet.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText(/Your stay|Pay now|Book it|Special requests|Test payments|Back to the shortlist|Who is booking|Signed in as|First name|Last name/)).toHaveCount(0);

    // The same page once the room is frozen, booked, released and cancelled: each in Spanish.
    const ref = 'E2E-ES-1';
    const until = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const holder = { firstName: 'Ana', lastName: 'Silva', email: 'ana@fixture.hotelfinder.invalid' };
    const receipt = page.getByRole('region', { name: 'Reserva' });
    await asIf(page, { status: 'frozen', reference: ref, frozenUntil: until, freezeReminderDueAt: until, freezeReminderSentAt: null, holder });
    await expect(receipt.getByRole('heading', { level: 1 })).toHaveText('Congelada');
    await expect(receipt).toContainText(/Esta habitación está reservada con el hotel por .+ y no se ha pagado nada\. Confirma y paga antes del .+ UTC para quedártela\./);
    await expect(receipt).toContainText('Nada todavía');
    await expect(receipt.getByRole('button', { name: /^Confirmar y pagar .+ con Google Pay$/ })).toBeVisible();
    await receipt.getByRole('button', { name: 'Liberarla', exact: true }).click();
    await expect(receipt.getByRole('group', { name: '¿Liberar esta habitación?' })).toContainText('No se puede deshacer.');
    await receipt.getByRole('button', { name: 'Seguir reteniéndola' }).click();

    await asIf(page, { status: 'confirmed', reference: ref, hotelConfirmationCode: 'H-1', holder, paidWith: 'apple_pay', testPayment: true, specialRequest: 'Una cuna, por favor' });
    await expect(receipt.getByRole('heading', { level: 1 })).toHaveText('Reservada');
    await expect(receipt.locator('dt').filter({ hasText: /^Pagado$/ }).locator('+ dd')).toHaveText(/^.+€ con Apple Pay \(pago de prueba: no se movió dinero\)$/);
    await expect(receipt).toContainText('Enviada al hotel con la reserva. Las peticiones no están garantizadas: decide el hotel.');
    await receipt.getByRole('button', { name: 'Cancelar esta reserva' }).click();
    await expect(receipt.getByRole('group', { name: '¿Cancelar esta reserva?' })).toBeVisible();
    await receipt.getByRole('button', { name: 'Mantenerla' }).click();

    await asIf(page, { status: 'cancelled', reference: ref, releasedBy: 'expiry', cancelFeeMinor: null });
    await expect(receipt.getByRole('heading', { level: 1 })).toHaveText('Liberada');
    await expect(receipt).toContainText('Liberada al terminar la retención');

    await asIf(page, { status: 'cancelled', reference: ref, releasedBy: null, refundMinor: null, testPayment: true });
    await expect(receipt.getByRole('heading', { level: 1 })).toHaveText('Cancelada');
    await expect(receipt).toContainText('Lo que decida el hotel · pago de prueba, nada que reembolsar');
    await expect(page.getByRole('link', { name: 'Volver a la selección', exact: true })).toBeVisible();
    await expect(page.getByText(/Booking reference|Held until|Release it|Cancel this booking|Booked|Frozen|Released|Cancelled|As the hotel decides/)).toHaveCount(0);
  });
}
