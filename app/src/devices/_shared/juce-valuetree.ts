// JUCE ValueTree binary stream format (ValueTree::writeToStream /
// readFromStream) - the container ControlTribe uses for sequence files.
//   tree  = type\0 cint(nProps) { name\0 var }* cint(nChildren) tree*
//   var   = cint(size) marker payload   (size counts marker + payload;
//           size 0 = void)
//   cint  = byte n (| 0x80 if negative), then n little-endian magnitude bytes
// Doubles and ints are distinct var types, so values carry a tag.

export type JVar =
  | { t: 'void' }
  | { t: 'undefined' }
  | { t: 'bool'; v: boolean }
  | { t: 'int'; v: number }
  | { t: 'int64'; v: bigint }
  | { t: 'double'; v: number }
  | { t: 'string'; v: string }
  | { t: 'array'; v: JVar[] }
  | { t: 'binary'; v: Uint8Array };

export interface ValueTree {
  type: string;
  props: [string, JVar][];
  children: ValueTree[];
}

export const jInt = (v: number): JVar => ({ t: 'int', v });
export const jDouble = (v: number): JVar => ({ t: 'double', v });
export const jStr = (v: string): JVar => ({ t: 'string', v });
export const jArr = (v: JVar[]): JVar => ({ t: 'array', v });

const M = {
  int: 1,
  boolTrue: 2,
  boolFalse: 3,
  double: 4,
  string: 5,
  int64: 6,
  array: 7,
  binary: 8,
  undefined: 9,
};

// numeric value of a var the way juce::var converts it (strings parse their
// leading number, as String::getIntValue / getDoubleValue do)
export function jNum(v: JVar | undefined): number | undefined {
  if (!v) return undefined;
  if (v.t === 'int' || v.t === 'double') return v.v;
  if (v.t === 'int64') return Number(v.v);
  if (v.t === 'bool') return v.v ? 1 : 0;
  if (v.t === 'string') {
    const n = parseFloat(v.v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function jProp(t: ValueTree, name: string): JVar | undefined {
  return t.props.find(([k]) => k === name)?.[1];
}

// ---- writer ----

class Out {
  private bytes: number[] = [];
  byte(b: number) {
    this.bytes.push(b & 0xff);
  }
  raw(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i]);
  }
  cint(v: number) {
    let u = Math.abs(v);
    const data: number[] = [];
    while (u > 0) {
      data.push(u & 0xff);
      u = Math.floor(u / 256);
    }
    this.byte(data.length | (v < 0 ? 0x80 : 0));
    this.raw(data);
  }
  str(s: string) {
    this.raw(new TextEncoder().encode(s));
    this.byte(0);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

function le(n: number, size: 4 | 8, float = false): Uint8Array {
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  if (float) dv.setFloat64(0, n, true);
  else dv.setInt32(0, n, true);
  return b;
}

function writeVar(o: Out, v: JVar) {
  switch (v.t) {
    case 'void':
      return o.cint(0);
    case 'undefined':
      o.cint(1);
      return o.byte(M.undefined);
    case 'bool':
      o.cint(1);
      return o.byte(v.v ? M.boolTrue : M.boolFalse);
    case 'int':
      o.cint(5);
      o.byte(M.int);
      return o.raw(le(v.v | 0, 4));
    case 'int64': {
      o.cint(9);
      o.byte(M.int64);
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigInt64(0, v.v, true);
      return o.raw(b);
    }
    case 'double':
      o.cint(9);
      o.byte(M.double);
      return o.raw(le(v.v, 8, true));
    case 'string': {
      const s = new TextEncoder().encode(v.v);
      o.cint(s.length + 2); // marker + text + NUL
      o.byte(M.string);
      o.raw(s);
      return o.byte(0);
    }
    case 'array': {
      const inner = new Out();
      inner.cint(v.v.length);
      for (const x of v.v) writeVar(inner, x);
      const b = inner.done();
      o.cint(b.length + 1);
      o.byte(M.array);
      return o.raw(b);
    }
    case 'binary':
      o.cint(v.v.length + 1);
      o.byte(M.binary);
      return o.raw(v.v);
  }
}

function writeTree(o: Out, t: ValueTree) {
  o.str(t.type);
  o.cint(t.props.length);
  for (const [k, v] of t.props) {
    o.str(k);
    writeVar(o, v);
  }
  o.cint(t.children.length);
  for (const c of t.children) writeTree(o, c);
}

export function vtWrite(t: ValueTree): Uint8Array {
  const o = new Out();
  writeTree(o, t);
  return o.done();
}

// ---- reader ----

class In {
  pos = 0;
  private b: Uint8Array;
  private dv: DataView;
  constructor(b: Uint8Array) {
    this.b = b;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  need(n: number) {
    if (this.pos + n > this.b.length) throw new Error('ValueTree: truncated');
  }
  byte(): number {
    this.need(1);
    return this.b[this.pos++];
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const r = this.b.slice(this.pos, this.pos + n);
    this.pos += n;
    return r;
  }
  cint(): number {
    const h = this.byte();
    const n = h & 0x7f;
    if (n > 4) throw new Error('ValueTree: bad compressed int');
    let v = 0;
    for (let i = 0; i < n; i++) v += this.byte() * 2 ** (8 * i);
    return h & 0x80 ? -v : v;
  }
  str(): string {
    const end = this.b.indexOf(0, this.pos);
    if (end < 0) throw new Error('ValueTree: unterminated string');
    const s = new TextDecoder().decode(this.b.subarray(this.pos, end));
    this.pos = end + 1;
    return s;
  }
  i32(): number {
    this.need(4);
    const v = this.dv.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i64(): bigint {
    this.need(8);
    const v = this.dv.getBigInt64(this.pos, true);
    this.pos += 8;
    return v;
  }
  f64(): number {
    this.need(8);
    const v = this.dv.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
}

function readVar(i: In): JVar {
  const size = i.cint();
  if (size <= 0) return { t: 'void' };
  const start = i.pos;
  const marker = i.byte();
  let v: JVar;
  switch (marker) {
    case M.int:
      v = { t: 'int', v: i.i32() };
      break;
    case M.int64:
      v = { t: 'int64', v: i.i64() };
      break;
    case M.boolTrue:
      v = { t: 'bool', v: true };
      break;
    case M.boolFalse:
      v = { t: 'bool', v: false };
      break;
    case M.double:
      v = { t: 'double', v: i.f64() };
      break;
    case M.string: {
      const raw = i.bytes(size - 1);
      const end = raw.indexOf(0);
      v = {
        t: 'string',
        v: new TextDecoder().decode(end < 0 ? raw : raw.subarray(0, end)),
      };
      break;
    }
    case M.array: {
      const n = i.cint();
      const items: JVar[] = [];
      for (let k = 0; k < n; k++) items.push(readVar(i));
      v = { t: 'array', v: items };
      break;
    }
    case M.binary:
      v = { t: 'binary', v: i.bytes(size - 1) };
      break;
    case M.undefined:
      v = { t: 'undefined' };
      break;
    default:
      v = { t: 'void' }; // unknown marker: skip its payload like JUCE does
  }
  i.pos = start + size; // the size field is authoritative
  return v;
}

function readTree(i: In): ValueTree {
  const type = i.str();
  if (!type) throw new Error('ValueTree: empty type (invalid tree)');
  const np = i.cint();
  if (np < 0) throw new Error('ValueTree: bad property count');
  const props: [string, JVar][] = [];
  for (let k = 0; k < np; k++) {
    const name = i.str();
    props.push([name, readVar(i)]);
  }
  const nc = i.cint();
  if (nc < 0) throw new Error('ValueTree: bad child count');
  const children: ValueTree[] = [];
  for (let k = 0; k < nc; k++) children.push(readTree(i));
  return { type, props, children };
}

export function vtRead(bytes: Uint8Array): ValueTree {
  return readTree(new In(bytes));
}
