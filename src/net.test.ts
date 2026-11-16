import { describe, expect, it } from 'vitest';
import { matchCode, newRoom, readCode } from './net';

describe('network match codes', () => {
  it('carry the room, both factions and the planet, and reject anything else', () => {
    const room = newRoom();
    const code = matchCode(room, ['humains', 'isdaris'], 'lune');
    expect(code).toMatch(/^[A-Z0-9]{4}-HIL$/);
    expect(readCode(code.toLowerCase(), ['desert', 'lune', 'alien'])).toEqual({ room, factions: ['humains', 'isdaris'], biome: 'lune' });
    expect(readCode(`${room}HHD`, ['desert', 'lune', 'alien'])?.factions).toEqual(['humains', 'humains']);
    expect(readCode('ABCD-XIL', ['desert', 'lune', 'alien'])).toBeNull();
    expect(readCode('ABCD-HIZ', ['desert', 'lune', 'alien'])).toBeNull();
  });
});
