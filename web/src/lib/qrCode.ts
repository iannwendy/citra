/**
 * ISO/IEC 18004 QR Code Matrix Generator (Byte Mode, Error Correction Level M).
 * Produces a 2D matrix of 1 (dark module) and 0 (light module) scannable by
 * iOS Camera, Android Camera, and dedicated QR readers.
 *
 * Adapted from Kazuhiko Arase's MIT-licensed QRCode reference implementation.
 */

const EXP_TABLE = new Array<number>(256);
const LOG_TABLE = new Array<number>(256);

for (let i = 0; i < 8; i++) {
  EXP_TABLE[i] = 1 << i;
}
for (let i = 8; i < 256; i++) {
  EXP_TABLE[i] =
    EXP_TABLE[i - 4]! ^
    EXP_TABLE[i - 5]! ^
    EXP_TABLE[i - 6]! ^
    EXP_TABLE[i - 8]!;
}
for (let i = 0; i < 255; i++) {
  LOG_TABLE[EXP_TABLE[i]!] = i;
}

function glog(n: number): number {
  if (n < 1) throw new Error(`glog(${n})`);
  return LOG_TABLE[n]!;
}

function gexp(n: number): number {
  let v = n;
  while (v < 0) v += 255;
  while (v >= 256) v -= 255;
  return EXP_TABLE[v]!;
}

class QRPolynomial {
  private readonly num: number[];

  constructor(num: number[], shift: number) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) {
      offset++;
    }
    this.num = new Array<number>(num.length - offset + shift).fill(0);
    for (let i = 0; i < num.length - offset; i++) {
      this.num[i] = num[i + offset]!;
    }
  }

  get(index: number): number {
    return this.num[index]!;
  }

  getLength(): number {
    return this.num.length;
  }

  multiply(e: QRPolynomial): QRPolynomial {
    const num = new Array<number>(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j]! ^= gexp(glog(this.get(i)) + glog(e.get(j)));
      }
    }
    return new QRPolynomial(num, 0);
  }

  mod(e: QRPolynomial): QRPolynomial {
    if (this.getLength() - e.getLength() < 0) {
      return this;
    }
    const ratio = glog(this.get(0)) - glog(e.get(0));
    const num = this.num.slice();
    for (let i = 0; i < e.getLength(); i++) {
      num[i]! ^= gexp(glog(e.get(i)) + ratio);
    }
    return new QRPolynomial(num, 0).mod(e);
  }
}

interface RSBlock {
  totalCount: number;
  dataCount: number;
}

// Error correction level M rows for versions 1..15: [count, totalCount, dataCount, ...]
const RS_BLOCK_TABLE_M: number[][] = [
  [1, 26, 16],
  [1, 44, 28],
  [1, 70, 44],
  [2, 50, 32],
  [2, 67, 43],
  [4, 43, 27],
  [4, 49, 31],
  [2, 60, 38, 2, 61, 39],
  [3, 58, 36, 2, 59, 37],
  [4, 69, 43, 1, 70, 44],
  [1, 80, 50, 4, 81, 51],
  [6, 58, 36, 2, 59, 37],
  [8, 59, 37, 1, 60, 38],
  [4, 64, 40, 5, 65, 41],
  [5, 65, 41, 5, 66, 42],
];

const PATTERN_POSITION_TABLE: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
];

function getRSBlocksM(version: number): RSBlock[] {
  const row = RS_BLOCK_TABLE_M[version - 1];
  if (!row) throw new Error(`Unsupported QR version: ${version}`);
  const list: RSBlock[] = [];
  for (let i = 0; i < row.length / 3; i++) {
    const count = row[i * 3]!;
    const totalCount = row[i * 3 + 1]!;
    const dataCount = row[i * 3 + 2]!;
    for (let j = 0; j < count; j++) {
      list.push({ totalCount, dataCount });
    }
  }
  return list;
}

class QRBitBuffer {
  readonly buffer: number[] = [];
  length = 0;

  put(num: number, length: number): void {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean): void {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex]! |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
}

const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const G18 =
  (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

function getBCHDigit(data: number): number {
  let digit = 0;
  let v = data;
  while (v !== 0) {
    digit++;
    v >>>= 1;
  }
  return digit;
}

function getBCHTypeInfo(data: number): number {
  let d = data << 10;
  while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
    d ^= G15 << (getBCHDigit(d) - getBCHDigit(G15));
  }
  return ((data << 10) | d) ^ G15_MASK;
}

function getBCHTypeNumber(data: number): number {
  let d = data << 12;
  while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
    d ^= G18 << (getBCHDigit(d) - getBCHDigit(G18));
  }
  return (data << 12) | d;
}

function getMask(maskPattern: number, i: number, j: number): boolean {
  switch (maskPattern) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    case 7:
      return (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
    default:
      return false;
  }
}

function getErrorCorrectPolynomial(errorCorrectLength: number): QRPolynomial {
  let a = new QRPolynomial([1], 0);
  for (let i = 0; i < errorCorrectLength; i++) {
    a = a.multiply(new QRPolynomial([1, gexp(i)], 0));
  }
  return a;
}

function createData(version: number, bytes: Uint8Array): number[] {
  const rsBlocks = getRSBlocksM(version);
  const buffer = new QRBitBuffer();
  // Mode 4 = 8-bit byte mode
  buffer.put(0x4, 4);
  const lenBits = version < 10 ? 8 : 16;
  buffer.put(bytes.length, lenBits);
  for (let i = 0; i < bytes.length; i++) {
    buffer.put(bytes[i]!, 8);
  }
  let totalDataCount = 0;
  for (const b of rsBlocks) {
    totalDataCount += b.dataCount;
  }
  if (buffer.length + 4 <= totalDataCount * 8) {
    buffer.put(0, 4);
  }
  while (buffer.length % 8 !== 0) {
    buffer.putBit(false);
  }
  while (buffer.length < totalDataCount * 8) {
    buffer.put(0xec, 8);
    if (buffer.length >= totalDataCount * 8) break;
    buffer.put(0x11, 8);
  }

  let offset = 0;
  let maxDcCount = 0;
  let maxEcCount = 0;
  const dcdata: number[][] = [];
  const ecdata: number[][] = [];

  for (const block of rsBlocks) {
    const dcCount = block.dataCount;
    const ecCount = block.totalCount - dcCount;
    maxDcCount = Math.max(maxDcCount, dcCount);
    maxEcCount = Math.max(maxEcCount, ecCount);
    const dc = buffer.buffer.slice(offset, offset + dcCount);
    dcdata.push(dc);
    offset += dcCount;

    const rsPoly = getErrorCorrectPolynomial(ecCount);
    const rawPoly = new QRPolynomial(dc, rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);
    const ecLen = rsPoly.getLength() - 1;
    const ec = new Array<number>(ecLen).fill(0);
    for (let i = 0; i < ecLen; i++) {
      const modIndex = i + modPoly.getLength() - ecLen;
      ec[i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
    }
    ecdata.push(ec);
  }

  const result: number[] = [];
  for (let i = 0; i < maxDcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < dcdata[r]!.length) {
        result.push(dcdata[r]![i]!);
      }
    }
  }
  for (let i = 0; i < maxEcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < ecdata[r]!.length) {
        result.push(ecdata[r]![i]!);
      }
    }
  }
  return result;
}

function getLostPoint(modules: (boolean | null)[][]): number {
  const moduleCount = modules.length;
  let lostPoint = 0;

  // Level 1
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      let sameCount = 0;
      const dark = Boolean(modules[row]![col]);
      for (let r = -1; r <= 1; r++) {
        if (row + r < 0 || moduleCount <= row + r) continue;
        for (let c = -1; c <= 1; c++) {
          if (col + c < 0 || moduleCount <= col + c) continue;
          if (r === 0 && c === 0) continue;
          if (dark === Boolean(modules[row + r]![col + c])) {
            sameCount++;
          }
        }
      }
      if (sameCount > 5) {
        lostPoint += 3 + sameCount - 5;
      }
    }
  }

  // Level 2
  for (let row = 0; row < moduleCount - 1; row++) {
    for (let col = 0; col < moduleCount - 1; col++) {
      let count = 0;
      if (modules[row]![col]) count++;
      if (modules[row + 1]![col]) count++;
      if (modules[row]![col + 1]) count++;
      if (modules[row + 1]![col + 1]) count++;
      if (count === 0 || count === 4) {
        lostPoint += 3;
      }
    }
  }

  // Level 3
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount - 6; col++) {
      if (
        modules[row]![col] &&
        !modules[row]![col + 1] &&
        modules[row]![col + 2] &&
        modules[row]![col + 3] &&
        modules[row]![col + 4] &&
        !modules[row]![col + 5] &&
        modules[row]![col + 6]
      ) {
        lostPoint += 40;
      }
    }
  }
  for (let col = 0; col < moduleCount; col++) {
    for (let row = 0; row < moduleCount - 6; row++) {
      if (
        modules[row]![col] &&
        !modules[row + 1]![col] &&
        modules[row + 2]![col] &&
        modules[row + 3]![col] &&
        modules[row + 4]![col] &&
        !modules[row + 5]![col] &&
        modules[row + 6]![col]
      ) {
        lostPoint += 40;
      }
    }
  }

  // Level 4
  let darkCount = 0;
  for (let col = 0; col < moduleCount; col++) {
    for (let row = 0; row < moduleCount; row++) {
      if (modules[row]![col]) darkCount++;
    }
  }
  const ratio = Math.abs((100 * darkCount) / moduleCount / moduleCount - 50) / 5;
  lostPoint += ratio * 10;
  return lostPoint;
}

function buildModules(
  version: number,
  dataCache: number[],
  test: boolean,
  maskPattern: number,
): (boolean | null)[][] {
  const moduleCount = version * 4 + 17;
  const modules: (boolean | null)[][] = Array.from({ length: moduleCount }, () =>
    new Array<boolean | null>(moduleCount).fill(null),
  );

  const setupPositionProbePattern = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || moduleCount <= col + c) continue;
        if (
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ) {
          modules[row + r]![col + c] = true;
        } else {
          modules[row + r]![col + c] = false;
        }
      }
    }
  };

  setupPositionProbePattern(0, 0);
  setupPositionProbePattern(moduleCount - 7, 0);
  setupPositionProbePattern(0, moduleCount - 7);

  // Position adjustment (alignment) patterns
  const pos = PATTERN_POSITION_TABLE[version - 1] ?? [];
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const row = pos[i]!;
      const col = pos[j]!;
      if (modules[row]![col] !== null) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
            modules[row + r]![col + c] = true;
          } else {
            modules[row + r]![col + c] = false;
          }
        }
      }
    }
  }

  // Timing patterns
  for (let r = 8; r < moduleCount - 8; r++) {
    if (modules[r]![6] === null) {
      modules[r]![6] = r % 2 === 0;
    }
  }
  for (let c = 8; c < moduleCount - 8; c++) {
    if (modules[6]![c] === null) {
      modules[6]![c] = c % 2 === 0;
    }
  }

  // Type info (Error correction level M = 0)
  const typeInfoData = (0 << 3) | maskPattern;
  const bits = getBCHTypeInfo(typeInfoData);
  for (let i = 0; i < 15; i++) {
    const mod = !test && ((bits >> i) & 1) === 1;
    if (i < 6) {
      modules[i]![8] = mod;
    } else if (i < 8) {
      modules[i + 1]![8] = mod;
    } else {
      modules[moduleCount - 15 + i]![8] = mod;
    }
  }
  for (let i = 0; i < 15; i++) {
    const mod = !test && ((bits >> i) & 1) === 1;
    if (i < 8) {
      modules[8]![moduleCount - i - 1] = mod;
    } else if (i < 9) {
      modules[8]![15 - i - 1 + 1] = mod;
    } else {
      modules[8]![15 - i - 1] = mod;
    }
  }
  modules[moduleCount - 8]![8] = !test;

  if (version >= 7) {
    const vBits = getBCHTypeNumber(version);
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((vBits >> i) & 1) === 1;
      modules[Math.floor(i / 3)]![(i % 3) + moduleCount - 8 - 3] = mod;
      modules[(i % 3) + moduleCount - 8 - 3]![Math.floor(i / 3)] = mod;
    }
  }

  // Map data bits
  let inc = -1;
  let row = moduleCount - 1;
  let bitIndex = 7;
  let byteIndex = 0;

  for (let col = moduleCount - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (let c = 0; c < 2; c++) {
        if (modules[row]![col - c] === null) {
          let dark = false;
          if (byteIndex < dataCache.length) {
            dark = ((dataCache[byteIndex]! >>> bitIndex) & 1) === 1;
          }
          const mask = getMask(maskPattern, row, col - c);
          if (mask) {
            dark = !dark;
          }
          modules[row]![col - c] = dark;
          bitIndex--;
          if (bitIndex === -1) {
            byteIndex++;
            bitIndex = 7;
          }
        }
      }
      row += inc;
      if (row < 0 || moduleCount <= row) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }

  return modules;
}

export function encodeQrMatrix(input: string): number[][] {
  let cleanInput = (input || 'https://citra.io.vn').trim();
  if (cleanInput.includes('|http')) {
    cleanInput = cleanInput.slice(cleanInput.indexOf('|http') + 1).trim();
  }
  const bytes = new TextEncoder().encode(cleanInput);

  let version = 1;
  for (let v = 1; v <= RS_BLOCK_TABLE_M.length; v++) {
    const rsBlocks = getRSBlocksM(v);
    const totalDataCount = rsBlocks.reduce((acc, b) => acc + b.dataCount, 0);
    const lenBits = v < 10 ? 8 : 16;
    const neededBits = 4 + lenBits + bytes.length * 8;
    if (neededBits <= totalDataCount * 8) {
      version = v;
      break;
    }
  }

  const dataCache = createData(version, bytes);
  let minLostPoint = Infinity;
  let bestPattern = 0;
  for (let i = 0; i < 8; i++) {
    const testModules = buildModules(version, dataCache, true, i);
    const lostPoint = getLostPoint(testModules);
    if (lostPoint < minLostPoint) {
      minLostPoint = lostPoint;
      bestPattern = i;
    }
  }

  const finalModules = buildModules(version, dataCache, false, bestPattern);
  return finalModules.map((row) => row.map((cell) => (cell ? 1 : 0)));
}
