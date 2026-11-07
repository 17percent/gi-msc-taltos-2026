import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { kindKeyFromLabel } from '../documents/validation';
import { documentApi, json, kinds } from '../test/documents';
import { makeMe, problem, renderApp } from '../test/helpers';

const admin = makeMe({ systemRole: 'system_admin' });

describe('Adminisztráció › Fajták', () => {
  it('a fül és a lista Rendszeradminnak; átnevezés/törlés nincs', async () => {
    documentApi({ me: admin });
    renderApp('/admin/kinds');
    expect(await screen.findByRole('link', { name: 'Fajták' })).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Fajták' });
    expect(within(table).getByText('Útmutató')).toBeTruthy();
    expect(within(table).getByText('guide')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Átnevezés|Törlés/ })).toBeNull();
  });

  it('nem Rendszeradmin nem éri el', async () => {
    const api = documentApi();
    renderApp('/admin/kinds');
    expect(await screen.findByRole('heading', { name: 'Nincs jogosultságod' })).toBeTruthy();
    // Sem a fül, sem az „Új fajta” gomb, és a lista lekérése sem fut le.
    expect(screen.queryByRole('link', { name: 'Fajták' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Új fajta' })).toBeNull();
    expect(api.callsTo('GET /api/v1/kinds')).toHaveLength(0);
  });

  it('a kulcs ékezetmentesen adódik a névből, szerkeszthető; a kérés törzse helyes', async () => {
    const api = documentApi({
      me: admin,
      routes: { 'POST /api/v1/kinds': json({ key: 'utmutato_es_sablon', label: 'x' }, 201) },
    });
    renderApp('/admin/kinds');
    fireEvent.click(await screen.findByRole('button', { name: 'Új fajta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Új fajta' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Név' }), {
      target: { value: 'Útmutató és sablon' },
    });
    const key = within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Kulcs' });
    expect(key.value).toBe('utmutato_es_sablon');
    fireEvent.change(key, { target: { value: 'sablon' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Név' }), {
      target: { value: 'Másik név' },
    });
    expect(key.value).toBe('sablon');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fajta felvétele' }));
    await waitFor(() => expect(api.callsTo('POST /api/v1/kinds')).toHaveLength(1));
    expect(api.callsTo('POST /api/v1/kinds')[0]?.body).toEqual({
      key: 'sablon',
      label: 'Másik név',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('érvénytelen kulcs és üres név kérés nélkül hibát ad; a szerver 400 üzenete', async () => {
    const api = documentApi({
      me: admin,
      routes: { 'POST /api/v1/kinds': () => problem(400, 'validation_error') },
    });
    renderApp('/admin/kinds');
    fireEvent.click(await screen.findByRole('button', { name: 'Új fajta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Új fajta' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fajta felvétele' }));
    expect(await within(dialog).findByText('Add meg a fajta nevét.')).toBeTruthy();
    expect(api.callsTo('POST /api/v1/kinds')).toHaveLength(0);
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Név' }), {
      target: { value: 'Jó' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Kulcs' }), {
      target: { value: '9Rossz' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fajta felvétele' }));
    expect(await within(dialog).findByText(/A kulcs kisbetűvel kezdődjön/)).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Kulcs' }), {
      target: { value: 'jo' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fajta felvétele' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Ezt a fajtát nem tudtuk felvenni',
    );
  });

  it('üres lista: állapot és gomb', async () => {
    documentApi({ me: admin, kinds: [] });
    renderApp('/admin/kinds');
    expect(await screen.findByText('Még nincs felvéve fajta.')).toBeTruthy();
    expect(kinds).toHaveLength(2);
  });

  it('kindKeyFromLabel: mintának megfelelő kulcsot ad', () => {
    expect(kindKeyFromLabel('MCP szerver')).toBe('mcp_szerver');
    expect(kindKeyFromLabel('1. Árvíztűrő tükörfúrógép')).toBe('arvizturo_tukorfurogep');
    expect(kindKeyFromLabel('x'.repeat(50))).toHaveLength(32);
    expect(kindKeyFromLabel('123')).toBe('');
    // Magyar ékezetek (ő, ű, hosszú ékezetek), írásjelek, zárójel, nagybetűk.
    expect(kindKeyFromLabel('Őrségi Űrlap')).toBe('orsegi_urlap');
    expect(kindKeyFromLabel('Fájl-import (v2)')).toBe('fajl_import_v2');
    // A 32 karakteres vágás után nem maradhat záró alávonás.
    expect(kindKeyFromLabel('a'.repeat(31) + ' b')).toBe('a'.repeat(31));
    // Ékezet nélkül nem képezhető (csak szám/írásjel): üres, a kulcs-validáció kezeli.
    expect(kindKeyFromLabel('  --  ')).toBe('');
    expect(kindKeyFromLabel('')).toBe('');
  });
});
