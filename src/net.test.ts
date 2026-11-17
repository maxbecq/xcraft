import { describe, expect, it } from 'vitest';
import { matchCode, newRoom, readCode } from './net';

describe('network match codes', () => {
  it('carry the room, both factions and the planet, and reject anything else', () => {
    const room = newRoom();
    const code = matchCode(room, ['humains', 'isdaris'], 'lune');
    expect(code).toMatch(/^[A-Z0-9]{4}-HIL$/);
    expect(readCode(code.toLowerCase(), ['desert', 'lune', 'alien'], ['origine', 'le-col'])).toEqual({ room, factions: ['humains', 'isdaris'], biome: 'lune', map: 'origine' });
    expect(readCode(`${room}HHD`, ['desert', 'lune', 'alien'])?.factions).toEqual(['humains', 'humains']);
    expect(readCode('ABCD-XIL', ['desert', 'lune', 'alien'])).toBeNull();
    expect(readCode('ABCD-HIZ', ['desert', 'lune', 'alien'])).toBeNull();
  });

  it('carry the map after the planet, none for the first map', () => {
    const maps = ['origine', 'carrefour', 'le-col'];
    const code = matchCode('ABCD', ['z', 'humains'], 'desert', 2);
    expect(code).toBe('ABCD-ZHD2');
    expect(readCode(code, ['desert'], maps)?.map).toBe('le-col');
    expect(readCode('ABCD-ZHD9', ['desert'], maps)?.map).toBe('origine');
  });
});
