// CSAFE-ramar för Concept2 PM3/PM4/PM5 (se Concept2 "PM CSAFE Communication Definition").
//
// Ram:  F1 <innehåll> <checksumma> F2
// Checksumma = XOR av alla innehållsbytes. Bytes F0–F3 i innehåll/checksumma
// byte-stuffas som F3 00..03.

export const FRAME_START = 0xf1;
export const FRAME_STOP = 0xf2;
const STUFF = 0xf3;

// Standard-CSAFE (korta kommandon, inga argument)
export const CMD = {
  GETSTATUS: 0x80,
  GETTWORK: 0xa0,
  GETHORIZONTAL: 0xa1,
  GETCALORIES: 0xa3,
  GETPACE: 0xa6,
  GETCADENCE: 0xa7,
  GETHRCUR: 0xb0,
  GETPOWER: 0xb4,
  // Wrapper för Concept2-specifika kommandon
  SETUSERCFG1: 0x1a,
};

// Concept2-specifika kommandon (skickas inuti SETUSERCFG1)
export const PM = {
  GET_WORKOUTSTATE: 0x8d,
  GET_WORKTIME: 0xa0,
  GET_WORKDISTANCE: 0xa3,
  GET_STROKESTATE: 0xbf,
  GET_DRAGFACTOR: 0xc1,
  // Långt kommando: argument = antal bytes att läsa (max 32). Svar: [antal, uint16 LE ...]
  // med kraftsampel (lbf) från PM:ens buffert för pågående/senaste drag.
  GET_FORCEPLOTDATA: 0x6b,
};

const xor = (bytes) => bytes.reduce((a, b) => a ^ b, 0);

function stuff(bytes) {
  const out = [];
  for (const b of bytes) {
    if (b >= 0xf0 && b <= 0xf3) out.push(STUFF, b - 0xf0);
    else out.push(b);
  }
  return out;
}

function unstuff(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === STUFF) out.push(0xf0 + bytes[++i]);
    else out.push(bytes[i]);
  }
  return out;
}

/**
 * Bygger en ram av korta standardkommandon plus (valfritt) PM-kommandon.
 * @param {number[]} std   standard-CSAFE-kommandon
 * @param {number[]} pm    Concept2-kommandon, läggs i en 0x1A-wrapper
 */
export function buildFrame(std = [], pm = []) {
  const content = [...std];
  if (pm.length) content.push(CMD.SETUSERCFG1, pm.length, ...pm);
  return Uint8Array.from([FRAME_START, ...stuff([...content, xor(content)]), FRAME_STOP]);
}

/**
 * Tolkar en hel svarsram (F1 ... F2).
 * @returns {{status:number, std:Map<number,number[]>, pm:Map<number,number[]>}}
 */
export function parseFrame(raw) {
  const start = raw.indexOf(FRAME_START);
  const stop = raw.indexOf(FRAME_STOP, start + 1);
  if (start < 0 || stop < 0) throw new Error('Ofullständig ram');

  const body = unstuff(raw.slice(start + 1, stop));
  const checksum = body.pop();
  if (xor(body) !== checksum) throw new Error('Fel checksumma');

  const status = body[0];
  const std = new Map();
  const pm = new Map();
  parseCommands(body.slice(1), std);
  const wrapped = std.get(CMD.SETUSERCFG1);
  if (wrapped) {
    std.delete(CMD.SETUSERCFG1);
    parseCommands(wrapped, pm);
  }
  return { status, std, pm };
}

// [id, längd, data...]*
function parseCommands(bytes, into) {
  let i = 0;
  while (i + 1 < bytes.length) {
    const id = bytes[i];
    const len = bytes[i + 1];
    into.set(id, bytes.slice(i + 2, i + 2 + len));
    i += 2 + len;
  }
}

/** Little-endian heltal från de första n bytena. */
export function le(bytes, n = bytes.length) {
  let v = 0;
  for (let i = n - 1; i >= 0; i--) v = v * 256 + (bytes[i] ?? 0);
  return v;
}
