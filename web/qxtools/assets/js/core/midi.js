/**
 * QXTools — zapis i odczyt Standard MIDI File (SMF).
 * Zapis: format 1, 480 ticków na ćwierćnutę, ścieżka tempa + ścieżka nut.
 */
import { midiToName } from './dsp.js';

export const TICKS_PER_QUARTER = 480;

const TRACK_NAMES = {
  tempo: 'QXTools tempo',
  notes: 'QXTools transcription',
};

class ByteWriter {
  constructor() {
    this.bytes = [];
  }

  push(value) {
    this.bytes.push(value & 0xff);
  }

  uint16(value) {
    this.push(value >> 8);
    this.push(value & 0xff);
  }

  uint32(value) {
    this.push((value >>> 24) & 0xff);
    this.push((value >>> 16) & 0xff);
    this.push((value >>> 8) & 0xff);
    this.push(value & 0xff);
  }

  string(text) {
    for (let i = 0; i < text.length; i += 1) this.push(text.charCodeAt(i) & 0xff);
  }

  varLen(value) {
    let v = Math.max(0, Math.floor(value));
    const stack = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      stack.push((v & 0x7f) | 0x80);
      v >>= 7;
    }
    while (stack.length) this.push(stack.pop());
  }

  toUint8Array() {
    return Uint8Array.from(this.bytes);
  }
}

class ByteReader {
  constructor(data) {
    this.data = data;
    this.pos = 0;
  }

  get remaining() {
    return this.data.length - this.pos;
  }

  byte() {
    return this.data[this.pos++];
  }

  uint16() {
    const v = (this.data[this.pos] << 8) | this.data[this.pos + 1];
    this.pos += 2;
    return v;
  }

  uint32() {
    const v =
      ((this.data[this.pos] << 24) |
        (this.data[this.pos + 1] << 16) |
        (this.data[this.pos + 2] << 8) |
        this.data[this.pos + 3]) >>>
      0;
    this.pos += 4;
    return v;
  }

  varLen() {
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const b = this.byte();
      value = (value << 7) | (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    return value;
  }

  text(length) {
    let out = '';
    for (let i = 0; i < length; i += 1) out += String.fromCharCode(this.byte());
    return out;
  }
}

function trackChunk(name, body) {
  const writer = new ByteWriter();
  writer.string('MTrk');
  writer.uint32(body.length);
  for (const b of body) writer.push(b);
  return writer.toUint8Array();
}

function metaEvent(delta, type, payload) {
  const writer = new ByteWriter();
  writer.varLen(delta);
  writer.push(0xff);
  writer.push(type);
  writer.varLen(payload.length);
  for (const b of payload) writer.push(b);
  return writer.bytes;
}

function textBytes(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) out.push(text.charCodeAt(i) & 0x7f);
  return out;
}

/**
 * Buduje plik .mid z listy nut.
 * @param {{pitch:number,start:number,duration:number,velocity:number}[]} notes
 * @param {{bpm?:number,name?:string,program?:number,channel?:number,trackName?:string}} [meta]
 * @returns {Uint8Array}
 */
export function writeMidi(notes, meta = {}) {
  const bpm = meta.bpm && Number.isFinite(meta.bpm) ? meta.bpm : 120;
  const tempo = Math.round(60000000 / bpm);
  const channel = meta.channel ?? 0;
  const program = meta.program ?? 0;

  // ścieżka tempa
  const tempoTrack = [];
  tempoTrack.push(...metaEvent(0, 0x03, textBytes(TRACK_NAMES.tempo)));
  tempoTrack.push(...metaEvent(0, 0x51, [(tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff]));
  if (meta.name) tempoTrack.push(...metaEvent(0, 0x01, textBytes(meta.name)));
  const lastTick = notes.reduce((acc, n) => Math.max(acc, (n.start + n.duration) * 2 * (TICKS_PER_QUARTER / 60) * bpm), 0);
  tempoTrack.push(...metaEvent(Math.max(1, Math.round(lastTick)), 0x2f, []));

  // ścieżka nut
  const events = [];
  const secondsToTicks = (seconds) => Math.max(0, Math.round(seconds * (bpm / 60) * TICKS_PER_QUARTER));
  for (const note of notes) {
    const startTick = secondsToTicks(note.start);
    const endTick = Math.max(startTick + 1, secondsToTicks(note.start + note.duration));
    const pitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    const velocity = Math.max(1, Math.min(127, Math.round(note.velocity ?? 90)));
    events.push({ tick: startTick, order: 0, data: [0x90 | channel, pitch, velocity] });
    events.push({ tick: endTick, order: 1, data: [0x80 | channel, pitch, 0x40] });
  }
  events.sort((a, b) => a.tick - b.tick || b.order - a.order);

  const noteTrack = [];
  noteTrack.push(...metaEvent(0, 0x03, textBytes(meta.trackName ?? TRACK_NAMES.notes)));
  noteTrack.push(...metaEvent(0, 0xc0 | channel, [program]));
  let previous = 0;
  let running = -1;
  for (const event of events) {
    const writer = new ByteWriter();
    writer.varLen(event.tick - previous);
    previous = event.tick;
    if (event.data[0] === running) {
      writer.push(event.data[1]);
      writer.push(event.data[2]);
    } else {
      running = event.data[0];
      writer.push(event.data[0]);
      writer.push(event.data[1]);
      writer.push(event.data[2]);
    }
    noteTrack.push(...writer.bytes);
  }
  noteTrack.push(...metaEvent(0, 0x2f, []));

  const header = new ByteWriter();
  header.string('MThd');
  header.uint32(6);
  header.uint16(1);
  header.uint16(2);
  header.uint16(TICKS_PER_QUARTER);

  const body = new ByteWriter();
  for (const b of header.toUint8Array()) body.push(b);
  for (const b of trackChunk('tempo', tempoTrack)) body.push(b);
  for (const b of trackChunk('notes', noteTrack)) body.push(b);
  return body.toUint8Array();
}

/**
 * Czyta SMF i zwraca nuty w sekundach (używane w testach i przy imporcie .mid).
 * @param {Uint8Array} bytes
 */
export function readMidi(bytes) {
  const reader = new ByteReader(bytes);
  if (reader.text(4) !== 'MThd') throw new Error('To nie jest plik MIDI (brak MThd)');
  const headerLength = reader.uint32();
  if (headerLength < 6) throw new Error('Uszkodzony nagłówek MIDI');
  const format = reader.uint16();
  const trackCount = reader.uint16();
  const division = reader.uint16();
  if (division & 0x8000) throw new Error('SMPTE timecode nie jest obsługiwany');
  const ticksPerQuarter = division;
  reader.pos = 8 + headerLength;

  let tempo = 500000;
  const trackNames = [];
  const notes = [];
  const openNotes = new Map();

  for (let t = 0; t < trackCount; t += 1) {
    if (reader.remaining < 8) break;
    const type = reader.text(4);
    const length = reader.uint32();
    if (type !== 'MTrk') {
      reader.pos += length;
      continue;
    }
    const end = reader.pos + length;
    let tick = 0;
    let runningStatus = 0;
    const secondsOf = (tk) => (tk * tempo) / (ticksPerQuarter * 1000000);
    while (reader.pos < end) {
      tick += reader.varLen();
      let status = reader.byte();
      if (status < 0x80) {
        reader.pos -= 1;
        status = runningStatus;
      } else {
        runningStatus = status;
      }
      if (status === 0xff) {
        const metaType = reader.byte();
        const len = reader.varLen();
        if (metaType === 0x51 && len === 3) {
          tempo = (reader.byte() << 16) | (reader.byte() << 8) | reader.byte();
        } else if (metaType === 0x03 || metaType === 0x01) {
          trackNames.push(reader.text(len));
        } else {
          reader.pos += len;
        }
      } else if (status === 0xf0 || status === 0xf7) {
        reader.pos += reader.varLen();
      } else {
        const typeNibble = status & 0xf0;
        const channel = status & 0x0f;
        const d1 = reader.byte();
        const d2 = reader.byte();
        if (typeNibble === 0x90 && d2 > 0) {
          const key = `${channel}:${d1}`;
          if (openNotes.has(key)) {
            const open = openNotes.get(key);
            notes.push({ ...open, duration: secondsOf(tick) - open.start });
          }
          openNotes.set(key, { pitch: d1, start: secondsOf(tick), velocity: d2, channel });
        } else if (typeNibble === 0x80 || (typeNibble === 0x90 && d2 === 0)) {
          const key = `${channel}:${d1}`;
          const open = openNotes.get(key);
          if (open) {
            notes.push({ ...open, duration: Math.max(0.01, secondsOf(tick) - open.start) });
            openNotes.delete(key);
          }
        }
      }
    }
    reader.pos = end;
    for (const open of openNotes.values()) {
      notes.push({ ...open, duration: Math.max(0.01, secondsOf(tick) - open.start) });
    }
    openNotes.clear();
  }

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return {
    format,
    trackCount,
    ticksPerQuarter,
    bpm: Math.round((60000000 / tempo) * 10) / 10,
    trackNames,
    notes,
    duration: notes.reduce((acc, n) => Math.max(acc, n.start + n.duration), 0),
  };
}

/** Lista nut jako czytelny tekst (do pobrania razem z .mid). */
export function notesToText(notes, bpm) {
  const lines = [
    '# QXTools — transkrypcja MP3 -> MIDI',
    `# tempo: ${bpm} BPM | nut: ${notes.length}`,
    '# lp\tczas[s]\ttakt.beat\tMIDI\tnazwa\tglosnosc\tdlugosc[s]',
  ];
  const beatOf = (s) => (s * bpm) / 60;
  notes.forEach((n, i) => {
    const beat = beatOf(n.start);
    lines.push(
      [
        `${i + 1}`,
        n.start.toFixed(3),
        `${Math.floor(beat / 4) + 1}.${(beat % 4).toFixed(2)}`,
        n.pitch,
        midiToName(n.pitch),
        n.velocity,
        n.duration.toFixed(3),
      ].join('\t'),
    );
  });
  return lines.join('\n');
}
