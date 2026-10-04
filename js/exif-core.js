/* EasyEXIF core: reads and writes photo metadata entirely in the browser.
   No dependencies. Exposes window.ExifCore.

   Reading:  JPEG, PNG, WebP, TIFF, HEIC/AVIF (EXIF only), plus XMP, IPTC and ICC.
   Writing:  JPEG, PNG and WebP (strip, replace or copy the EXIF block). */
(() => {
  'use strict';

  const utf8 = new TextDecoder('utf-8');
  const enc = new TextEncoder();
  const ascii = (u8, start, end) => { let s = ''; for (let i = start; i < end && i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
  const startsWith = (u8, str, at = 0) => { for (let i = 0; i < str.length; i++) if (u8[at + i] !== str.charCodeAt(i)) return false; return true; };
  const concat = parts => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const u16be = n => new Uint8Array([n >> 8 & 255, n & 255]);
  const u32be = n => new Uint8Array([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
  const u32le = n => new Uint8Array([n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255]);

  /* ------------------------------------------------------------------ tag tables */
  const TIFF_TAGS = {
    0x100: 'ImageWidth', 0x101: 'ImageHeight', 0x102: 'BitsPerSample', 0x103: 'Compression', 0x106: 'PhotometricInterpretation',
    0x10e: 'ImageDescription', 0x10f: 'Make', 0x110: 'Model', 0x111: 'StripOffsets', 0x112: 'Orientation', 0x115: 'SamplesPerPixel',
    0x116: 'RowsPerStrip', 0x117: 'StripByteCounts', 0x11a: 'XResolution', 0x11b: 'YResolution', 0x11c: 'PlanarConfiguration',
    0x128: 'ResolutionUnit', 0x12d: 'TransferFunction', 0x131: 'Software', 0x132: 'ModifyDate', 0x13b: 'Artist', 0x13c: 'HostComputer',
    0x13e: 'WhitePoint', 0x13f: 'PrimaryChromaticities', 0x201: 'ThumbnailOffset', 0x202: 'ThumbnailLength', 0x211: 'YCbCrCoefficients',
    0x212: 'YCbCrSubSampling', 0x213: 'YCbCrPositioning', 0x214: 'ReferenceBlackWhite', 0x8298: 'Copyright', 0x8769: 'ExifOffset',
    0x8825: 'GPSInfo', 0x9c9b: 'XPTitle', 0x9c9c: 'XPComment', 0x9c9d: 'XPAuthor', 0x9c9e: 'XPKeywords', 0x9c9f: 'XPSubject',
    0xc4a5: 'PrintIM', 0xc612: 'DNGVersion', 0xa431: 'BodySerialNumber'
  };
  const EXIF_TAGS = {
    0x829a: 'ExposureTime', 0x829d: 'FNumber', 0x8822: 'ExposureProgram', 0x8824: 'SpectralSensitivity', 0x8827: 'ISO', 0x8828: 'OECF',
    0x8830: 'SensitivityType', 0x8831: 'StandardOutputSensitivity', 0x8832: 'RecommendedExposureIndex', 0x8833: 'ISOSpeed',
    0x9000: 'ExifVersion', 0x9003: 'DateTimeOriginal', 0x9004: 'CreateDate', 0x9010: 'OffsetTime', 0x9011: 'OffsetTimeOriginal',
    0x9012: 'OffsetTimeDigitized', 0x9101: 'ComponentsConfiguration', 0x9102: 'CompressedBitsPerPixel', 0x9201: 'ShutterSpeedValue',
    0x9202: 'ApertureValue', 0x9203: 'BrightnessValue', 0x9204: 'ExposureCompensation', 0x9205: 'MaxApertureValue', 0x9206: 'SubjectDistance',
    0x9207: 'MeteringMode', 0x9208: 'LightSource', 0x9209: 'Flash', 0x920a: 'FocalLength', 0x9214: 'SubjectArea', 0x927c: 'MakerNote',
    0x9286: 'UserComment', 0x9290: 'SubSecTime', 0x9291: 'SubSecTimeOriginal', 0x9292: 'SubSecTimeDigitized', 0xa000: 'FlashpixVersion',
    0xa001: 'ColorSpace', 0xa002: 'PixelXDimension', 0xa003: 'PixelYDimension', 0xa004: 'RelatedSoundFile', 0xa005: 'InteropOffset',
    0xa20b: 'FlashEnergy', 0xa20e: 'FocalPlaneXResolution', 0xa20f: 'FocalPlaneYResolution', 0xa210: 'FocalPlaneResolutionUnit',
    0xa214: 'SubjectLocation', 0xa215: 'ExposureIndex', 0xa217: 'SensingMethod', 0xa300: 'FileSource', 0xa301: 'SceneType', 0xa302: 'CFAPattern',
    0xa401: 'CustomRendered', 0xa402: 'ExposureMode', 0xa403: 'WhiteBalance', 0xa404: 'DigitalZoomRatio', 0xa405: 'FocalLengthIn35mmFormat',
    0xa406: 'SceneCaptureType', 0xa407: 'GainControl', 0xa408: 'Contrast', 0xa409: 'Saturation', 0xa40a: 'Sharpness',
    0xa40b: 'DeviceSettingDescription', 0xa40c: 'SubjectDistanceRange', 0xa420: 'ImageUniqueID', 0xa430: 'CameraOwnerName',
    0xa431: 'BodySerialNumber', 0xa432: 'LensSpecification', 0xa433: 'LensMake', 0xa434: 'LensModel', 0xa435: 'LensSerialNumber',
    0xa460: 'CompositeImage', 0xa500: 'Gamma'
  };
  const GPS_TAGS = {
    0: 'GPSVersionID', 1: 'GPSLatitudeRef', 2: 'GPSLatitude', 3: 'GPSLongitudeRef', 4: 'GPSLongitude', 5: 'GPSAltitudeRef', 6: 'GPSAltitude',
    7: 'GPSTimeStamp', 8: 'GPSSatellites', 9: 'GPSStatus', 10: 'GPSMeasureMode', 11: 'GPSDOP', 12: 'GPSSpeedRef', 13: 'GPSSpeed',
    14: 'GPSTrackRef', 15: 'GPSTrack', 16: 'GPSImgDirectionRef', 17: 'GPSImgDirection', 18: 'GPSMapDatum', 19: 'GPSDestLatitudeRef',
    20: 'GPSDestLatitude', 21: 'GPSDestLongitudeRef', 22: 'GPSDestLongitude', 23: 'GPSDestBearingRef', 24: 'GPSDestBearing',
    25: 'GPSDestDistanceRef', 26: 'GPSDestDistance', 27: 'GPSProcessingMethod', 28: 'GPSAreaInformation', 29: 'GPSDateStamp',
    30: 'GPSDifferential', 31: 'GPSHPositioningError'
  };
  const INTEROP_TAGS = { 1: 'InteropIndex', 2: 'InteropVersion' };
  const TAGS = { ifd0: TIFF_TAGS, ifd1: TIFF_TAGS, exif: EXIF_TAGS, gps: GPS_TAGS, interop: INTEROP_TAGS };
  const NAME_TO_TAG = {};
  for (const kind of Object.keys(TAGS)) {
    NAME_TO_TAG[kind] = {};
    for (const [tag, name] of Object.entries(TAGS[kind])) NAME_TO_TAG[kind][name] = Number(tag);
  }
  const GROUP_TITLES = { ifd0: 'Camera & image', exif: 'Exposure & capture', gps: 'GPS location', interop: 'Interoperability', ifd1: 'Embedded thumbnail' };

  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

  const ENUMS = {
    Orientation: { 1: 'Normal', 2: 'Mirrored horizontally', 3: 'Rotated 180°', 4: 'Mirrored vertically', 5: 'Mirrored, rotated 90° CCW', 6: 'Rotated 90° CW', 7: 'Mirrored, rotated 90° CW', 8: 'Rotated 90° CCW' },
    ResolutionUnit: { 1: 'None', 2: 'Inches', 3: 'Centimeters' },
    FocalPlaneResolutionUnit: { 1: 'None', 2: 'Inches', 3: 'Centimeters', 4: 'Millimeters', 5: 'Micrometers' },
    Compression: { 1: 'Uncompressed', 6: 'JPEG (old-style)', 7: 'JPEG', 8: 'Deflate', 34892: 'Lossy JPEG' },
    PhotometricInterpretation: { 0: 'WhiteIsZero', 1: 'BlackIsZero', 2: 'RGB', 3: 'Palette', 6: 'YCbCr' },
    YCbCrPositioning: { 1: 'Centered', 2: 'Co-sited' },
    ExposureProgram: { 0: 'Not defined', 1: 'Manual', 2: 'Program AE', 3: 'Aperture priority', 4: 'Shutter priority', 5: 'Creative (slow)', 6: 'Action (fast)', 7: 'Portrait', 8: 'Landscape' },
    MeteringMode: { 0: 'Unknown', 1: 'Average', 2: 'Center-weighted', 3: 'Spot', 4: 'Multi-spot', 5: 'Multi-segment', 6: 'Partial', 255: 'Other' },
    LightSource: { 0: 'Unknown', 1: 'Daylight', 2: 'Fluorescent', 3: 'Tungsten', 4: 'Flash', 9: 'Fine weather', 10: 'Cloudy', 11: 'Shade', 12: 'Daylight fluorescent', 13: 'Day white fluorescent', 14: 'Cool white fluorescent', 15: 'White fluorescent', 17: 'Standard light A', 18: 'Standard light B', 19: 'Standard light C', 20: 'D55', 21: 'D65', 22: 'D75', 23: 'D50', 24: 'ISO studio tungsten', 255: 'Other' },
    ColorSpace: { 1: 'sRGB', 2: 'Adobe RGB', 65533: 'Wide gamut RGB', 65535: 'Uncalibrated' },
    SensingMethod: { 1: 'Not defined', 2: 'One-chip color area', 3: 'Two-chip color area', 4: 'Three-chip color area', 5: 'Color sequential area', 7: 'Trilinear', 8: 'Color sequential linear' },
    FileSource: { 1: 'Film scanner', 2: 'Reflection print scanner', 3: 'Digital camera' },
    SceneType: { 1: 'Directly photographed' },
    CustomRendered: { 0: 'Normal', 1: 'Custom', 2: 'HDR', 3: 'Panorama', 6: 'Portrait', 8: 'Portrait HDR' },
    ExposureMode: { 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' },
    WhiteBalance: { 0: 'Auto', 1: 'Manual' },
    SceneCaptureType: { 0: 'Standard', 1: 'Landscape', 2: 'Portrait', 3: 'Night' },
    GainControl: { 0: 'None', 1: 'Low gain up', 2: 'High gain up', 3: 'Low gain down', 4: 'High gain down' },
    Contrast: { 0: 'Normal', 1: 'Low', 2: 'High' },
    Saturation: { 0: 'Normal', 1: 'Low', 2: 'High' },
    Sharpness: { 0: 'Normal', 1: 'Soft', 2: 'Hard' },
    SubjectDistanceRange: { 0: 'Unknown', 1: 'Macro', 2: 'Close', 3: 'Distant' },
    SensitivityType: { 0: 'Unknown', 1: 'Standard output sensitivity', 2: 'Recommended exposure index', 3: 'ISO speed', 4: 'SOS + REI', 5: 'SOS + ISO speed', 6: 'REI + ISO speed', 7: 'SOS + REI + ISO speed' },
    CompositeImage: { 0: 'Unknown', 1: 'Not a composite', 2: 'General composite', 3: 'Composite of captured images' },
    GPSAltitudeRef: { 0: 'Above sea level', 1: 'Below sea level' },
    GPSLatitudeRef: { N: 'North', S: 'South' },
    GPSLongitudeRef: { E: 'East', W: 'West' },
    GPSStatus: { A: 'Measurement active', V: 'Measurement void' },
    GPSSpeedRef: { K: 'km/h', M: 'mph', N: 'knots' },
    GPSTrackRef: { T: 'True north', M: 'Magnetic north' },
    GPSImgDirectionRef: { T: 'True north', M: 'Magnetic north' },
    GPSMeasureMode: { 2: '2-D', 3: '3-D' }
  };

  /* ------------------------------------------------------------------ TIFF / EXIF reader */
  function decodeValue(type, count, bytes, little) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const list = [];
    let rat = null;
    switch (type) {
      case 2: {
        let end = bytes.indexOf(0);
        if (end < 0) end = bytes.length;
        return { value: utf8.decode(bytes.subarray(0, end)) };
      }
      case 1: case 7:
        if (type === 1 && count === 1) return { value: bytes[0] };
        return { value: bytes.slice() };
      case 3: for (let i = 0; i < count; i++) list.push(dv.getUint16(i * 2, little)); break;
      case 4: case 13: for (let i = 0; i < count; i++) list.push(dv.getUint32(i * 4, little)); break;
      case 6: for (let i = 0; i < count; i++) list.push(dv.getInt8(i)); break;
      case 8: for (let i = 0; i < count; i++) list.push(dv.getInt16(i * 2, little)); break;
      case 9: for (let i = 0; i < count; i++) list.push(dv.getInt32(i * 4, little)); break;
      case 11: for (let i = 0; i < count; i++) list.push(dv.getFloat32(i * 4, little)); break;
      case 12: for (let i = 0; i < count; i++) list.push(dv.getFloat64(i * 8, little)); break;
      case 5: case 10: {
        rat = [];
        for (let i = 0; i < count; i++) {
          const n = type === 5 ? dv.getUint32(i * 8, little) : dv.getInt32(i * 8, little);
          const d = type === 5 ? dv.getUint32(i * 8 + 4, little) : dv.getInt32(i * 8 + 4, little);
          rat.push([n, d]);
          list.push(d === 0 ? NaN : n / d);
        }
        break;
      }
      default: return { value: null };
    }
    return { value: count === 1 ? list[0] : list, rat };
  }

  /** Parses a TIFF block (the part of EXIF that starts with "II*\0" or "MM\0*"). */
  function parseTiff(u8) {
    if (!u8 || u8.length < 8) return null;
    const little = u8[0] === 0x49 && u8[1] === 0x49;
    if (!little && !(u8[0] === 0x4d && u8[1] === 0x4d)) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint16(2, little) !== 42) return null;
    const result = { little, ifd0: null, exif: null, gps: null, interop: null, ifd1: null, thumbnail: null, length: u8.length };
    const seen = new Set();

    function readIfd(offset) {
      if (!offset || offset + 2 > u8.length || seen.has(offset)) return null;
      seen.add(offset);
      const n = dv.getUint16(offset, little);
      const entries = [];
      for (let i = 0; i < n; i++) {
        const eo = offset + 2 + i * 12;
        if (eo + 12 > u8.length) break;
        const tag = dv.getUint16(eo, little), type = dv.getUint16(eo + 2, little), count = dv.getUint32(eo + 4, little);
        const unit = TYPE_SIZE[type];
        if (!unit) continue;
        const size = unit * count;
        if (size > u8.length) continue;
        const vo = size <= 4 ? eo + 8 : dv.getUint32(eo + 8, little);
        if (vo + size > u8.length) continue;
        const bytes = u8.subarray(vo, vo + size);
        const { value, rat } = decodeValue(type, count, bytes, little);
        entries.push({ tag, type, count, value, rat, bytes, entryOffset: eo });
      }
      let next = 0;
      const no = offset + 2 + n * 12;
      if (no + 4 <= u8.length) next = dv.getUint32(no, little);
      return { entries, next };
    }
    const find = (ifd, tag) => ifd && ifd.entries.find(e => e.tag === tag);

    const first = readIfd(dv.getUint32(4, little));
    if (!first) return result;
    result.ifd0 = first;
    const exifPtr = find(first, 0x8769), gpsPtr = find(first, 0x8825);
    if (exifPtr) result.exif = readIfd(exifPtr.value);
    if (gpsPtr) result.gps = readIfd(gpsPtr.value);
    const interopPtr = find(result.exif, 0xa005);
    if (interopPtr) result.interop = readIfd(interopPtr.value);
    if (first.next) result.ifd1 = readIfd(first.next);
    const tOff = find(result.ifd1, 0x201), tLen = find(result.ifd1, 0x202);
    if (tOff && tLen && tOff.value + tLen.value <= u8.length && tLen.value > 4) {
      const t = u8.subarray(tOff.value, tOff.value + tLen.value);
      if (t[0] === 0xff && t[1] === 0xd8) result.thumbnail = t.slice();
    }
    return result;
  }

  /* ------------------------------------------------------------------ value formatting */
  const fix = (n, d = 2) => (Number.isFinite(n) ? String(+n.toFixed(d)) : '—');
  const humanize = name => name
    .replace(/^GPS/, 'GPS ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\bX Resolution\b/, 'X resolution').replace(/\bY Resolution\b/, 'Y resolution')
    .trim();
  const asArray = v => (Array.isArray(v) ? v : ArrayBuffer.isView(v) ? Array.from(v) : [v]);

  function exposureText(v) {
    if (!(v > 0)) return '0 s';
    if (v >= 1) return fix(v, 1) + ' s';
    const inv = 1 / v;
    return v < 0.3 ? '1/' + Math.round(inv) + ' s' : fix(v, 2) + ' s';
  }
  function dms(entry) {
    const v = asArray(entry.value);
    if (v.length < 3) return fix(v[0], 4);
    return `${fix(v[0], 0)}° ${fix(v[1], 0)}′ ${fix(v[2], 2)}″`;
  }
  function decodeUserComment(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 8) return '';
    const head = ascii(bytes, 0, 8);
    const body = bytes.subarray(8);
    if (head.startsWith('UNICODE')) return new TextDecoder('utf-16be').decode(body).replace(/\0+$/, '');
    return utf8.decode(body).replace(/\0+$/, '');
  }
  function flashText(v) {
    if (v & 0x20) return 'No flash function';
    const modes = { 0: '', 1: 'compulsory', 2: 'suppressed', 3: 'auto' };
    const bits = [(v & 1) ? 'Fired' : 'Did not fire'];
    const mode = modes[v >> 3 & 3];
    if (mode) bits.push(mode);
    if (v & 0x40) bits.push('red-eye reduction');
    return bits.join(', ');
  }
  function ucs2(bytes) { return new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, ''); }

  /** Human-readable text for an entry. */
  function formatEntry(kind, name, e) {
    const v = e.value;
    const num = Array.isArray(v) ? v[0] : v;
    const enumMap = ENUMS[name];
    if (enumMap && !Array.isArray(v) && enumMap[v] !== undefined) return enumMap[v];
    switch (name) {
      case 'ExposureTime': return exposureText(num);
      case 'FNumber': return 'f/' + fix(num, 1);
      case 'ApertureValue': case 'MaxApertureValue': return 'f/' + fix(Math.pow(2, num / 2), 1);
      case 'ShutterSpeedValue': return exposureText(Math.pow(2, -num));
      case 'FocalLength': return fix(num, 1) + ' mm';
      case 'FocalLengthIn35mmFormat': return fix(num, 0) + ' mm';
      case 'ExposureCompensation': return (num > 0 ? '+' : '') + fix(num, 2) + ' EV';
      case 'BrightnessValue': return fix(num, 2) + ' EV';
      case 'SubjectDistance': return fix(num, 2) + ' m';
      case 'DigitalZoomRatio': return fix(num, 2) + '×';
      case 'ISO': case 'ISOSpeed': return String(Array.isArray(v) ? v.join(', ') : v);
      case 'Flash': return flashText(num);
      case 'ExifVersion': case 'FlashpixVersion': case 'InteropVersion': return e.bytes ? ascii(e.bytes, 0, e.bytes.length) : String(v);
      case 'ComponentsConfiguration': return Array.from(e.bytes).map(b => ({ 1: 'Y', 2: 'Cb', 3: 'Cr', 4: 'R', 5: 'G', 6: 'B' }[b] || '–')).filter(s => s !== '–').join(', ');
      case 'UserComment': return decodeUserComment(e.bytes) || '(empty)';
      case 'XPTitle': case 'XPComment': case 'XPAuthor': case 'XPKeywords': case 'XPSubject': return ucs2(e.bytes);
      case 'GPSVersionID': return Array.from(e.bytes).join('.');
      case 'GPSLatitude': case 'GPSLongitude': case 'GPSDestLatitude': case 'GPSDestLongitude': return dms(e);
      case 'GPSAltitude': return fix(num, 1) + ' m';
      case 'GPSTimeStamp': { const t = asArray(v); return t.length >= 3 ? t.map((x, i) => i === 2 ? fix(x, 2).padStart(2, '0') : String(Math.round(x)).padStart(2, '0')).join(':') + ' UTC' : String(v); }
      case 'GPSSpeed': return fix(num, 1);
      case 'GPSImgDirection': case 'GPSTrack': case 'GPSDestBearing': return fix(num, 1) + '°';
      case 'LensSpecification': { const l = asArray(v); return l.length === 4 ? `${fix(l[0], 0)}–${fix(l[1], 0)} mm, f/${fix(l[2], 1)}–${fix(l[3], 1)}`.replace(/(\d+)–\1 mm/, '$1 mm').replace(/f\/([\d.]+)–\1/, 'f/$1') : String(v); }
      case 'XResolution': case 'YResolution': case 'FocalPlaneXResolution': case 'FocalPlaneYResolution': return fix(num, 2);
      case 'MakerNote': case 'PrintIM': case 'OECF': case 'CFAPattern': case 'DeviceSettingDescription': return `(${e.bytes.length} bytes of binary data)`;
      default: break;
    }
    if (e.type === 2) return String(v);
    if (v instanceof Uint8Array) return v.length > 24 ? `(${v.length} bytes of binary data)` : Array.from(v).join(' ');
    if (Array.isArray(v)) return v.length > 16 ? v.slice(0, 16).map(x => fix(x, 4)).join(', ') + ` … (${v.length} values)` : v.map(x => fix(x, 4)).join(', ');
    return fix(v, 4);
  }

  function entryRaw(e) {
    if (e.value instanceof Uint8Array) return Array.from(e.value.subarray(0, 64));
    return e.value;
  }

  /** Flattens the parsed TIFF into display rows grouped by IFD. */
  function tiffToGroups(tiff) {
    const groups = [];
    const lookup = (kind, name) => {
      const ifd = tiff[kind];
      return ifd && ifd.entries.find(e => e.tag === NAME_TO_TAG[kind][name]);
    };
    for (const kind of ['ifd0', 'exif', 'gps', 'interop', 'ifd1']) {
      const ifd = tiff[kind];
      if (!ifd) continue;
      const rows = [];
      for (const e of ifd.entries) {
        if (kind !== 'gps' && (e.tag === 0x8769 || e.tag === 0x8825 || e.tag === 0xa005)) continue;
        if (kind === 'ifd1' && (e.tag === 0x201 || e.tag === 0x202)) continue;
        const name = TAGS[kind][e.tag] || 'Tag 0x' + e.tag.toString(16).toUpperCase().padStart(4, '0');
        let display = formatEntry(kind, name, e);
        // Show the reference letter next to its coordinate, e.g. "37° 46′ 29.70″ N".
        const refName = { GPSLatitude: 'GPSLatitudeRef', GPSLongitude: 'GPSLongitudeRef' }[name];
        if (refName) { const r = lookup('gps', refName); if (r) display += ' ' + r.value; }
        rows.push({ kind, tag: e.tag, name, label: humanize(name), value: display, raw: entryRaw(e) });
      }
      if (rows.length) groups.push({ id: kind, title: GROUP_TITLES[kind], rows });
    }
    return groups;
  }

  function getEntry(tiff, kind, name) {
    const ifd = tiff && tiff[kind];
    const tag = NAME_TO_TAG[kind][name];
    return ifd ? ifd.entries.find(e => e.tag === tag) : undefined;
  }
  function gpsFrom(tiff) {
    const lat = getEntry(tiff, 'gps', 'GPSLatitude'), lon = getEntry(tiff, 'gps', 'GPSLongitude');
    if (!lat || !lon) return null;
    const conv = (e, ref) => {
      const v = asArray(e.value);
      if (v.length < 3 || v.some(x => !Number.isFinite(x))) return null;
      const deg = v[0] + v[1] / 60 + v[2] / 3600;
      return /^[SW]/i.test(ref || '') ? -deg : deg;
    };
    const latRef = getEntry(tiff, 'gps', 'GPSLatitudeRef'), lonRef = getEntry(tiff, 'gps', 'GPSLongitudeRef');
    const la = conv(lat, latRef && latRef.value), lo = conv(lon, lonRef && lonRef.value);
    if (la === null || lo === null || (la === 0 && lo === 0)) return null;
    const alt = getEntry(tiff, 'gps', 'GPSAltitude'), altRef = getEntry(tiff, 'gps', 'GPSAltitudeRef');
    return { lat: la, lon: lo, altitude: alt ? (altRef && altRef.value === 1 ? -alt.value : alt.value) : null };
  }

  /* ------------------------------------------------------------------ containers */
  function detectFormat(u8) {
    if (u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8) return 'jpeg';
    if (startsWith(u8, '\x89PNG\r\n\x1a\n')) return 'png';
    if (startsWith(u8, 'RIFF') && startsWith(u8, 'WEBP', 8)) return 'webp';
    if (startsWith(u8, 'GIF8')) return 'gif';
    if ((u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 0x2a && u8[3] === 0) || (u8[0] === 0x4d && u8[1] === 0x4d && u8[2] === 0 && u8[3] === 0x2a)) return 'tiff';
    if (startsWith(u8, 'ftyp', 4)) {
      const brand = ascii(u8, 8, 12);
      if (/^(avif|avis)$/.test(brand)) return 'avif';
      if (/^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(brand)) return 'heic';
    }
    if (startsWith(u8, 'BM')) return 'bmp';
    return 'unknown';
  }
  const WRITABLE = new Set(['jpeg', 'png', 'webp']);

  /* --- JPEG --- */
  function jpegSegments(u8) {
    const segs = [];
    let pos = 2;
    while (pos < u8.length - 1) {
      if (u8[pos] !== 0xff) { pos++; continue; }
      let marker = u8[pos + 1];
      if (marker === 0xff) { pos++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0) { pos += 2; continue; }
      if (marker === 0xd9) { segs.push({ marker, start: pos, end: pos + 2, dataStart: pos + 2, eoi: true }); break; }
      if (pos + 4 > u8.length) break;
      const len = (u8[pos + 2] << 8) | u8[pos + 3];
      const end = Math.min(pos + 2 + len, u8.length);
      segs.push({ marker, start: pos, end, dataStart: pos + 4 });
      pos = end;
      if (marker === 0xda) {
        // Skip entropy-coded data until the next real marker.
        while (pos < u8.length - 1) {
          if (u8[pos] === 0xff) {
            const m = u8[pos + 1];
            if (m !== 0 && !(m >= 0xd0 && m <= 0xd7) && m !== 0xff) break;
          }
          pos++;
        }
      }
    }
    return segs;
  }
  const isExifSeg = (u8, s) => s.marker === 0xe1 && startsWith(u8, 'Exif\0\0', s.dataStart);
  const isXmpSeg = (u8, s) => s.marker === 0xe1 && startsWith(u8, 'http://ns.adobe.com/xap/1.0/\0', s.dataStart);
  const isIccSeg = (u8, s) => s.marker === 0xe2 && startsWith(u8, 'ICC_PROFILE\0', s.dataStart);

  function jpegExifTiff(u8) {
    for (const s of jpegSegments(u8)) if (isExifSeg(u8, s)) return u8.subarray(s.dataStart + 6, s.end);
    return null;
  }
  function jpegSegment(marker, payload) {
    const len = payload.length + 2;
    if (len > 0xffff) throw new Error('Metadata block is too large for a JPEG segment.');
    return concat([new Uint8Array([0xff, marker]), u16be(len), payload]);
  }
  function jpegRebuild(u8, { dropExif = true, dropXmp = false, dropIptc = false, dropIcc = false, dropComments = false, dropOther = false, dropTrailer = false, insertExif = null }) {
    const segs = jpegSegments(u8);
    const out = [new Uint8Array([0xff, 0xd8])];
    let inserted = !insertExif;
    let cursor = 2;
    const exifSeg = insertExif ? jpegSegment(0xe1, concat([enc.encode('Exif\0\0'), insertExif])) : null;
    for (const s of segs) {
      // Copy any gap between segments (entropy data after SOS) untouched.
      if (s.start > cursor) out.push(u8.subarray(cursor, s.start));
      cursor = s.end;
      if (s.eoi) { out.push(u8.subarray(s.start, s.end)); cursor = s.end; break; }
      const m = s.marker;
      let drop = false;
      if (isExifSeg(u8, s)) drop = dropExif;
      else if (isXmpSeg(u8, s) || (m === 0xe1 && startsWith(u8, 'http://ns.adobe.com/xmp/extension/\0', s.dataStart))) drop = dropXmp;
      else if (m === 0xed) drop = dropIptc;
      else if (isIccSeg(u8, s)) drop = dropIcc;
      else if (m === 0xfe) drop = dropComments;
      else if (m === 0xe2 && startsWith(u8, 'MPF\0', s.dataStart)) drop = dropOther;
      else if (m >= 0xe1 && m <= 0xef && m !== 0xee && m !== 0xe2) drop = dropOther; // other APPn (Adobe APP14 kept)
      if (drop) continue;
      // The Exif block goes straight after the leading JFIF APP0, or the SOI when there is none.
      if (!inserted && m !== 0xe0) { out.push(exifSeg); inserted = true; }
      out.push(u8.subarray(s.start, s.end));
    }
    if (!inserted) out.splice(1, 0, exifSeg);
    if (cursor < u8.length && !dropTrailer && !segs.some(s => s.eoi)) out.push(u8.subarray(cursor));
    return concat(out);
  }

  /* --- PNG --- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8, start = 0, end = u8.length) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function pngChunks(u8) {
    const chunks = [];
    let pos = 8;
    while (pos + 8 <= u8.length) {
      const len = ((u8[pos] << 24) | (u8[pos + 1] << 16) | (u8[pos + 2] << 8) | u8[pos + 3]) >>> 0;
      const type = ascii(u8, pos + 4, pos + 8);
      const end = pos + 12 + len;
      if (end > u8.length) break;
      chunks.push({ type, start: pos, dataStart: pos + 8, dataEnd: pos + 8 + len, end });
      pos = end;
      if (type === 'IEND') break;
    }
    return chunks;
  }
  function pngChunk(type, data) {
    const body = concat([enc.encode(type), data]);
    return concat([u32be(data.length), body, u32be(crc32(body))]);
  }
  const PNG_META = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
  function pngRebuild(u8, { dropExif = true, dropText = false, insertExif = null }) {
    const out = [u8.subarray(0, 8)];
    let inserted = !insertExif;
    for (const c of pngChunks(u8)) {
      if (c.type === 'eXIf' && dropExif) continue;
      if ((c.type === 'tEXt' || c.type === 'zTXt' || c.type === 'iTXt' || c.type === 'tIME') && dropText) continue;
      if (!inserted && c.type === 'IDAT') { out.push(pngChunk('eXIf', insertExif)); inserted = true; }
      out.push(u8.subarray(c.start, c.end));
    }
    if (!inserted) out.splice(out.length - 1, 0, pngChunk('eXIf', insertExif));
    return concat(out);
  }
  function pngExifTiff(u8) {
    for (const c of pngChunks(u8)) if (c.type === 'eXIf') {
      const d = u8.subarray(c.dataStart, c.dataEnd);
      return startsWith(d, 'Exif\0\0') ? d.subarray(6) : d;
    }
    return null;
  }

  /* --- WebP --- */
  function webpChunks(u8) {
    const chunks = [];
    let pos = 12;
    while (pos + 8 <= u8.length) {
      const type = ascii(u8, pos, pos + 4);
      const len = (u8[pos + 4] | (u8[pos + 5] << 8) | (u8[pos + 6] << 16) | (u8[pos + 7] << 24)) >>> 0;
      const end = Math.min(pos + 8 + len + (len & 1), u8.length);
      chunks.push({ type, start: pos, dataStart: pos + 8, dataEnd: Math.min(pos + 8 + len, u8.length), end });
      pos = end;
    }
    return chunks;
  }
  function webpChunk(type, data) {
    return concat([enc.encode(type), u32le(data.length), data, data.length & 1 ? new Uint8Array(1) : new Uint8Array(0)]);
  }
  function webpExifTiff(u8) {
    for (const c of webpChunks(u8)) if (c.type === 'EXIF') {
      const d = u8.subarray(c.dataStart, c.dataEnd);
      return startsWith(d, 'Exif\0\0') ? d.subarray(6) : d;
    }
    return null;
  }
  function webpDimensions(u8, chunks) {
    for (const c of chunks) {
      const d = u8.subarray(c.dataStart, c.dataEnd);
      if (c.type === 'VP8X' && d.length >= 10) return { w: 1 + (d[4] | d[5] << 8 | d[6] << 16), h: 1 + (d[7] | d[8] << 8 | d[9] << 16), alpha: !!(d[0] & 0x10) };
      if (c.type === 'VP8L' && d.length >= 5 && d[0] === 0x2f) {
        const bits = d[1] | d[2] << 8 | d[3] << 16 | d[4] << 24;
        return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, alpha: !!((bits >>> 28) & 1) };
      }
      if (c.type === 'VP8 ' && d.length >= 10 && d[3] === 0x9d && d[4] === 0x01 && d[5] === 0x2a) return { w: (d[6] | d[7] << 8) & 0x3fff, h: (d[8] | d[9] << 8) & 0x3fff, alpha: false };
    }
    return null;
  }
  function webpRebuild(u8, { dropExif = true, dropXmp = false, insertExif = null }) {
    const chunks = webpChunks(u8);
    const kept = [];
    let vp8x = null;
    for (const c of chunks) {
      if (c.type === 'EXIF' && dropExif) continue;
      if (c.type === 'XMP ' && dropXmp) continue;
      if (c.type === 'VP8X') { vp8x = c; continue; }
      kept.push(u8.subarray(c.start, c.end));
    }
    const dims = webpDimensions(u8, chunks);
    let flags = vp8x ? u8[vp8x.dataStart] : 0;
    let canvas = vp8x ? u8.slice(vp8x.dataStart + 4, vp8x.dataStart + 10) : null;
    if (!vp8x && insertExif) {
      if (!dims) throw new Error('Could not read this WebP file’s size.');
      flags = dims.alpha ? 0x10 : 0;
      canvas = new Uint8Array([(dims.w - 1) & 255, (dims.w - 1) >> 8 & 255, (dims.w - 1) >> 16 & 255, (dims.h - 1) & 255, (dims.h - 1) >> 8 & 255, (dims.h - 1) >> 16 & 255]);
    }
    const chunkTypes = new Set(chunks.map(c => c.type));
    const hasExif = insertExif || (!dropExif && chunkTypes.has('EXIF'));
    const hasXmp = !dropXmp && chunkTypes.has('XMP ');
    flags = (flags & ~0x0c) | (hasExif ? 0x08 : 0) | (hasXmp ? 0x04 : 0);
    const body = [];
    if (canvas) body.push(webpChunk('VP8X', concat([new Uint8Array([flags, 0, 0, 0]), canvas])));
    // Keep everything except trailing EXIF/XMP in place, then put EXIF before XMP.
    const xmpParts = [], mainParts = [];
    for (const part of kept) (ascii(part, 0, 4) === 'XMP ' ? xmpParts : mainParts).push(part);
    body.push(...mainParts);
    if (insertExif) body.push(webpChunk('EXIF', insertExif));
    body.push(...xmpParts);
    const payload = concat([enc.encode('WEBP'), ...body]);
    return concat([enc.encode('RIFF'), u32le(payload.length), payload]);
  }

  /** Raw TIFF/EXIF block for any supported container (or null). */
  function extractExifTiff(u8) {
    const fmt = detectFormat(u8);
    if (fmt === 'jpeg') return jpegExifTiff(u8);
    if (fmt === 'png') return pngExifTiff(u8);
    if (fmt === 'webp') return webpExifTiff(u8);
    if (fmt === 'tiff') return u8;
    if (fmt === 'heic' || fmt === 'avif') {
      const limit = Math.min(u8.length - 10, 8 << 20);
      for (let i = 4; i < limit; i++) {
        if (u8[i] === 0x45 && startsWith(u8, 'Exif\0\0', i)) {
          const t = i + 6;
          if ((u8[t] === 0x49 && u8[t + 1] === 0x49 && u8[t + 2] === 0x2a) || (u8[t] === 0x4d && u8[t + 1] === 0x4d && u8[t + 3] === 0x2a)) return u8.subarray(t);
        }
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ XMP, IPTC, ICC */
  function jpegXmp(u8) {
    for (const s of jpegSegments(u8)) if (isXmpSeg(u8, s)) return utf8.decode(u8.subarray(s.dataStart + 29, s.end));
    return null;
  }
  function pngTextChunks(u8) {
    const out = [];
    for (const c of pngChunks(u8)) {
      const d = u8.subarray(c.dataStart, c.dataEnd);
      if (c.type === 'tEXt') {
        const z = d.indexOf(0);
        if (z > 0) out.push({ key: ascii(d, 0, z), text: ascii(d, z + 1, d.length) });
      } else if (c.type === 'iTXt') {
        const z = d.indexOf(0);
        if (z <= 0) continue;
        const compressed = d[z + 1] === 1;
        let p = z + 3;
        while (p < d.length && d[p] !== 0) p++;   // language tag
        p++;
        while (p < d.length && d[p] !== 0) p++;   // translated keyword
        p++;
        out.push({ key: ascii(d, 0, z), text: compressed ? null : utf8.decode(d.subarray(p)) });
      } else if (c.type === 'zTXt') {
        const z = d.indexOf(0);
        if (z > 0) out.push({ key: ascii(d, 0, z), text: null });
      }
    }
    return out;
  }
  function webpXmp(u8) {
    for (const c of webpChunks(u8)) if (c.type === 'XMP ') return utf8.decode(u8.subarray(c.dataStart, c.dataEnd));
    return null;
  }

  function xmpRows(xml) {
    const rows = [];
    let doc;
    try { doc = new DOMParser().parseFromString(xml.replace(/^﻿/, '').replace(/<\?xpacket[^>]*\?>/g, ''), 'application/xml'); } catch (e) { return rows; }
    if (doc.querySelector('parsererror')) return rows;
    const text = el => {
      const items = el.getElementsByTagNameNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'li');
      if (items.length) return Array.from(items).map(li => li.textContent.trim()).filter(Boolean).join(', ');
      if (el.children.length) {
        return Array.from(el.children).map(c => `${c.localName}: ${c.textContent.trim()}`).join('; ');
      }
      return el.textContent.trim();
    };
    for (const desc of doc.getElementsByTagNameNS('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'Description')) {
      for (const a of Array.from(desc.attributes)) {
        if (a.name.startsWith('xmlns') || a.prefix === 'rdf' || a.prefix === 'xml') continue;
        rows.push({ name: a.name, label: humanize(a.localName), value: a.value });
      }
      for (const child of Array.from(desc.children)) {
        const v = text(child);
        if (v) rows.push({ name: child.prefix ? `${child.prefix}:${child.localName}` : child.localName, label: humanize(child.localName), value: v.length > 600 ? v.slice(0, 600) + '…' : v });
      }
    }
    return rows.slice(0, 300);
  }

  const IPTC_NAMES = {
    5: 'ObjectName', 15: 'Category', 20: 'SupplementalCategory', 25: 'Keywords', 40: 'SpecialInstructions', 55: 'DateCreated', 60: 'TimeCreated',
    80: 'By-line', 85: 'By-lineTitle', 90: 'City', 92: 'Sublocation', 95: 'Province-State', 100: 'CountryCode', 101: 'Country', 103: 'OriginalTransmissionReference',
    105: 'Headline', 110: 'Credit', 115: 'Source', 116: 'CopyrightNotice', 118: 'Contact', 120: 'Caption-Abstract', 122: 'WriterEditor'
  };
  function jpegIptc(u8) {
    const rows = [];
    for (const s of jpegSegments(u8)) {
      if (s.marker !== 0xed || !startsWith(u8, 'Photoshop 3.0\0', s.dataStart)) continue;
      let p = s.dataStart + 14;
      while (p + 12 <= s.end && startsWith(u8, '8BIM', p)) {
        const id = (u8[p + 4] << 8) | u8[p + 5];
        let q = p + 6;
        const nameLen = u8[q];
        q += 1 + nameLen;
        if ((1 + nameLen) & 1) q++;
        const size = ((u8[q] << 24) | (u8[q + 1] << 16) | (u8[q + 2] << 8) | u8[q + 3]) >>> 0;
        q += 4;
        if (id === 0x0404) {
          let r = q;
          const end = Math.min(q + size, s.end);
          while (r + 5 <= end && u8[r] === 0x1c) {
            const rec = u8[r + 1], ds = u8[r + 2], len = (u8[r + 3] << 8) | u8[r + 4];
            if (len & 0x8000) break;
            if (rec === 2 && IPTC_NAMES[ds]) rows.push({ name: IPTC_NAMES[ds], label: humanize(IPTC_NAMES[ds].replace(/-/g, ' ')), value: utf8.decode(u8.subarray(r + 5, r + 5 + len)) });
            r += 5 + len;
          }
        }
        p = q + size + (size & 1);
      }
    }
    // Merge repeated datasets (keywords) into one row.
    const merged = [];
    for (const row of rows) {
      const prev = merged.find(m => m.name === row.name);
      if (prev) prev.value += ', ' + row.value; else merged.push({ ...row });
    }
    return merged;
  }

  function iccInfo(u8, fmt) {
    let profile = null;
    if (fmt === 'jpeg') {
      const parts = [];
      for (const s of jpegSegments(u8)) if (isIccSeg(u8, s)) parts.push({ seq: u8[s.dataStart + 12], data: u8.subarray(s.dataStart + 14, s.end) });
      if (parts.length) profile = concat(parts.sort((a, b) => a.seq - b.seq).map(p => p.data));
    } else if (fmt === 'webp') {
      for (const c of webpChunks(u8)) if (c.type === 'ICCP') profile = u8.subarray(c.dataStart, c.dataEnd);
    }
    if (!profile || profile.length < 132) return null;
    const dv = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
    const info = {
      Size: profile.length + ' bytes', Version: `${profile[8]}.${profile[9] >> 4}`, Class: ascii(profile, 12, 16).trim(), 'Color space': ascii(profile, 16, 20).trim(), 'Connection space': ascii(profile, 20, 24).trim()
    };
    const count = dv.getUint32(128);
    for (let i = 0; i < count && 132 + i * 12 + 12 <= profile.length; i++) {
      const o = 132 + i * 12;
      if (ascii(profile, o, o + 4) !== 'desc') continue;
      const off = dv.getUint32(o + 4);
      const type = ascii(profile, off, off + 4);
      if (type === 'desc') { const n = dv.getUint32(off + 8); info.Description = ascii(profile, off + 12, off + 12 + Math.max(0, n - 1)); }
      else if (type === 'mluc') { const rLen = dv.getUint32(off + 20), rOff = dv.getUint32(off + 24); info.Description = new TextDecoder('utf-16be').decode(profile.subarray(off + rOff, off + rOff + rLen)).replace(/\0+$/, ''); }
    }
    return info;
  }

  /* ------------------------------------------------------------------ container info */
  function jpegInfo(u8) {
    const info = {};
    for (const s of jpegSegments(u8)) {
      const m = s.marker;
      if (m === 0xe0 && startsWith(u8, 'JFIF\0', s.dataStart)) {
        const d = s.dataStart;
        info['JFIF version'] = `${u8[d + 5]}.${String(u8[d + 6]).padStart(2, '0')}`;
        const units = u8[d + 7], x = (u8[d + 8] << 8) | u8[d + 9], y = (u8[d + 10] << 8) | u8[d + 11];
        info.Density = units === 0 ? `${x}:${y} (aspect ratio)` : `${x} × ${y} ${units === 1 ? 'dpi' : 'dpcm'}`;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc && !info.Width) {
        const d = s.dataStart;
        info['Bits per sample'] = u8[d];
        info.Height = (u8[d + 1] << 8) | u8[d + 2];
        info.Width = (u8[d + 3] << 8) | u8[d + 4];
        info['Color components'] = u8[d + 5];
        info.Encoding = [0xc0, 0xc1].includes(m) ? 'Baseline DCT' : [0xc2, 0xc6, 0xca, 0xce].includes(m) ? 'Progressive DCT' : 'JPEG';
      }
    }
    return info;
  }
  function pngInfo(u8) {
    const info = {};
    for (const c of pngChunks(u8)) {
      const d = u8.subarray(c.dataStart, c.dataEnd);
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      if (c.type === 'IHDR') {
        info.Width = dv.getUint32(0); info.Height = dv.getUint32(4); info['Bit depth'] = d[8];
        info['Color type'] = { 0: 'Grayscale', 2: 'RGB', 3: 'Palette', 4: 'Grayscale + alpha', 6: 'RGBA' }[d[9]] || d[9];
        info.Interlace = d[12] ? 'Adam7' : 'None';
      } else if (c.type === 'pHYs') {
        const x = dv.getUint32(0), y = dv.getUint32(4);
        info.Density = d[8] === 1 ? `${Math.round(x * 0.0254)} × ${Math.round(y * 0.0254)} dpi` : `${x} × ${y}`;
      } else if (c.type === 'tIME') {
        info['Last modified'] = `${dv.getUint16(0)}-${String(d[2]).padStart(2, '0')}-${String(d[3]).padStart(2, '0')} ${String(d[4]).padStart(2, '0')}:${String(d[5]).padStart(2, '0')}:${String(d[6]).padStart(2, '0')} UTC`;
      } else if (c.type === 'acTL') info.Animation = `${dv.getUint32(0)} frames`;
      else if (c.type === 'gAMA') info.Gamma = fix(100000 / dv.getUint32(0), 3);
      else if (c.type === 'sRGB') info['Color profile'] = 'sRGB';
    }
    return info;
  }
  function webpInfo(u8) {
    const chunks = webpChunks(u8);
    const dims = webpDimensions(u8, chunks);
    const info = {};
    if (dims) { info.Width = dims.w; info.Height = dims.h; info.Alpha = dims.alpha ? 'Yes' : 'No'; }
    info.Encoding = chunks.some(c => c.type === 'VP8L') ? 'Lossless' : chunks.some(c => c.type === 'VP8 ') ? 'Lossy' : chunks.some(c => c.type === 'ANMF') ? 'Animated' : 'Unknown';
    return info;
  }

  /* ------------------------------------------------------------------ reading API */
  const FORMAT_NAMES = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP', tiff: 'TIFF', heic: 'HEIC', avif: 'AVIF', gif: 'GIF', bmp: 'BMP', unknown: 'Unknown' };

  function pick(tiff, kind, name) {
    const e = getEntry(tiff, kind, name);
    if (!e) return null;
    const s = formatEntry(kind, name, e);
    return s === '' ? null : s;
  }
  const clean = s => (s == null ? null : String(s).trim() || null);

  function readMetadata(buffer) {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const fmt = detectFormat(u8);
    const out = {
      format: fmt, formatName: FORMAT_NAMES[fmt], canWrite: WRITABLE.has(fmt), size: u8.length,
      tiff: null, exifBytes: null, groups: [], gps: null, thumbnail: null, xmp: null, summary: {}, flags: [], hasMetadata: false
    };
    const tiffBytes = extractExifTiff(u8);
    out.exifBytes = tiffBytes;
    let tiff = null;
    try { tiff = tiffBytes ? parseTiff(tiffBytes) : null; } catch (e) { tiff = null; }
    out.tiff = tiff;
    if (tiff) {
      out.groups.push(...tiffToGroups(tiff));
      out.gps = gpsFrom(tiff);
      out.thumbnail = tiff.thumbnail;
    }

    let info = null, xmp = null, iptc = [];
    try {
      if (fmt === 'jpeg') { info = jpegInfo(u8); xmp = jpegXmp(u8); iptc = jpegIptc(u8); }
      else if (fmt === 'png') {
        info = pngInfo(u8);
        const texts = pngTextChunks(u8);
        const x = texts.find(t => t.key === 'XML:com.adobe.xmp');
        if (x && x.text) xmp = x.text;
        const rows = texts.filter(t => t.key !== 'XML:com.adobe.xmp').map(t => ({ name: t.key, label: t.key, value: t.text === null ? '(compressed text)' : t.text.length > 600 ? t.text.slice(0, 600) + '…' : t.text }));
        if (rows.length) out.groups.push({ id: 'text', title: 'PNG text', rows });
      } else if (fmt === 'webp') { info = webpInfo(u8); xmp = webpXmp(u8); }
    } catch (e) { /* keep whatever was read */ }

    const rowsOf = obj => Object.entries(obj).map(([k, v]) => ({ name: k, label: k, value: String(v) }));
    if (info && Object.keys(info).length) out.groups.unshift({ id: 'file', title: `${FORMAT_NAMES[fmt]} details`, rows: rowsOf(info) });
    out.info = info || {};
    if (iptc.length) out.groups.push({ id: 'iptc', title: 'IPTC', rows: iptc });
    if (xmp) {
      out.xmp = xmp;
      const rows = xmpRows(xmp);
      if (rows.length) out.groups.push({ id: 'xmp', title: 'XMP', rows });
    }
    const icc = iccInfo(u8, fmt);
    if (icc) out.groups.push({ id: 'icc', title: 'Color profile (ICC)', rows: rowsOf(icc) });

    // Headline details and privacy flags.
    const s = out.summary;
    const make = clean(pick(tiff, 'ifd0', 'Make')), model = clean(pick(tiff, 'ifd0', 'Model'));
    if (model) s.camera = make && !model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? `${make} ${model}` : model;
    else if (make) s.camera = make;
    s.lens = clean(pick(tiff, 'exif', 'LensModel'));
    const exposureBits = [];
    const fl = pick(tiff, 'exif', 'FocalLength'), fn = pick(tiff, 'exif', 'FNumber'), et = pick(tiff, 'exif', 'ExposureTime'), iso = pick(tiff, 'exif', 'ISO');
    if (fl) exposureBits.push(fl.replace(/\.0 mm$/, ' mm')); if (fn) exposureBits.push(fn); if (et) exposureBits.push(et); if (iso) exposureBits.push('ISO ' + iso);
    s.exposure = exposureBits.join(' · ') || null;
    s.date = clean(pick(tiff, 'exif', 'DateTimeOriginal')) || clean(pick(tiff, 'exif', 'CreateDate')) || clean(pick(tiff, 'ifd0', 'ModifyDate'));
    s.software = clean(pick(tiff, 'ifd0', 'Software'));
    s.artist = clean(pick(tiff, 'ifd0', 'Artist')) || clean(pick(tiff, 'exif', 'CameraOwnerName'));
    s.copyright = clean(pick(tiff, 'ifd0', 'Copyright'));
    const iw = info && info.Width, ih = info && info.Height;
    const pw = tiff && (getEntry(tiff, 'exif', 'PixelXDimension') || getEntry(tiff, 'ifd0', 'ImageWidth')), ph = tiff && (getEntry(tiff, 'exif', 'PixelYDimension') || getEntry(tiff, 'ifd0', 'ImageHeight'));
    s.dimensions = iw && ih ? `${iw} × ${ih}` : pw && ph ? `${pw.value} × ${ph.value}` : null;

    const flag = (id, level, title, detail) => out.flags.push({ id, level, title, detail });
    if (out.gps) flag('gps', 'high', 'Exact location (GPS)', `This photo records where it was taken: ${out.gps.lat.toFixed(5)}, ${out.gps.lon.toFixed(5)}.`);
    if (tiff && (getEntry(tiff, 'exif', 'BodySerialNumber') || getEntry(tiff, 'exif', 'LensSerialNumber') || getEntry(tiff, 'ifd0', 'BodySerialNumber')))
      flag('serial', 'high', 'Camera serial number', 'A unique number that can link photos to one specific camera or lens.');
    if (s.artist || (xmp && /creator|CameraOwner/i.test(xmp)) || iptc.some(r => r.name === 'By-line'))
      flag('owner', 'medium', 'Owner or author name', 'A name is embedded in this file.');
    if (tiff && out.thumbnail) flag('thumb', 'medium', 'Embedded thumbnail', 'A small preview of the original is stored inside. It can survive cropping and edits.');
    if (s.date) flag('date', 'low', 'Date and time taken', s.date);
    if (s.camera) flag('camera', 'low', 'Camera / phone model', s.camera);
    if (s.software) flag('software', 'low', 'Editing software', s.software);
    if (tiff && getEntry(tiff, 'exif', 'UserComment')) flag('comment', 'medium', 'Comment field', 'There is free text stored in this photo.');
    if (xmp) flag('xmp', 'low', 'XMP data', 'Editing history, ratings or keywords may be stored here.');
    if (iptc.length) flag('iptc', 'low', 'IPTC data', 'Captions, credits, keywords or location names may be stored here.');

    out.hasMetadata = out.groups.some(g => g.id !== 'file' && g.id !== 'icc') && (!!tiff || !!xmp || iptc.length > 0 || out.groups.some(g => g.id === 'text'));
    return out;
  }

  /* ------------------------------------------------------------------ writing: EXIF model */
  const POINTER_TAGS = new Set([0x8769, 0x8825, 0xa005]);
  const DROP_ON_REBUILD = new Set([0x201, 0x202, 0x111, 0x117, 0x116, 0x927c]);

  /** Copies a parsed TIFF into an editable model. MakerNote and thumbnail are dropped (their offsets can't be moved safely). */
  function toModel(tiff) {
    const model = { little: tiff ? tiff.little : true, ifd0: [], exif: [], gps: [], interop: [] };
    if (!tiff) return model;
    for (const kind of ['ifd0', 'exif', 'gps', 'interop']) {
      const ifd = tiff[kind];
      if (!ifd) continue;
      for (const e of ifd.entries) {
        if (POINTER_TAGS.has(e.tag) && kind !== 'gps') continue;
        if (kind !== 'gps' && DROP_ON_REBUILD.has(e.tag)) continue;
        model[kind].push({ tag: e.tag, type: e.type, count: e.count, bytes: e.bytes.slice() });
      }
    }
    return model;
  }
  const cloneModel = m => ({ little: m.little, ifd0: m.ifd0.slice(), exif: m.exif.slice(), gps: m.gps.slice(), interop: m.interop.slice() });

  function toRational(x) {
    if (!Number.isFinite(x)) return [0, 1];
    const sign = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    for (const d of [1, 10, 100, 1000, 10000, 100000, 1000000]) {
      const n = Math.round(a * d);
      if (Math.abs(n / d - a) < 1e-9 * Math.max(1, a)) return [sign * n, d];
    }
    return [sign * Math.round(a * 1000000), 1000000];
  }
  function encodeEntry(model, tag, type, value) {
    const little = model.little;
    const buf = u => new DataView(u.buffer);
    let bytes, count;
    if (type === 2) { bytes = concat([enc.encode(String(value)), new Uint8Array(1)]); count = bytes.length; }
    else if (type === 1 || type === 7) { bytes = Uint8Array.from(asArray(value)); count = bytes.length; }
    else if (type === 3) { const l = asArray(value); bytes = new Uint8Array(l.length * 2); l.forEach((v, i) => buf(bytes).setUint16(i * 2, v, little)); count = l.length; }
    else if (type === 4) { const l = asArray(value); bytes = new Uint8Array(l.length * 4); l.forEach((v, i) => buf(bytes).setUint32(i * 4, v, little)); count = l.length; }
    else if (type === 5 || type === 10) {
      // value: a number, or an array of [n, d] pairs / numbers
      const l = asArray(value).map(v => (Array.isArray(v) ? v : toRational(v)));
      bytes = new Uint8Array(l.length * 8);
      l.forEach((p, i) => { const dv = buf(bytes); if (type === 5) { dv.setUint32(i * 8, p[0], little); dv.setUint32(i * 8 + 4, p[1], little); } else { dv.setInt32(i * 8, p[0], little); dv.setInt32(i * 8 + 4, p[1], little); } });
      count = l.length;
    } else throw new Error('Unsupported EXIF type ' + type);
    return { tag, type, count, bytes };
  }
  function setEntry(model, kind, tag, type, value) {
    const list = model[kind].filter(e => e.tag !== tag);
    list.push(encodeEntry(model, tag, type, value));
    model[kind] = list;
  }
  function removeEntry(model, kind, tag) { model[kind] = model[kind].filter(e => e.tag !== tag); }

  /** Serializes a model back into a TIFF block. */
  function serializeModel(model) {
    const little = model.little;
    const ifds = [
      { kind: 'ifd0', entries: model.ifd0.slice() },
      { kind: 'exif', entries: model.exif.slice() },
      { kind: 'gps', entries: model.gps.slice() },
      { kind: 'interop', entries: model.interop.slice() }
    ];
    const byKind = Object.fromEntries(ifds.map(i => [i.kind, i]));
    // Link the sub-IFDs with pointer entries (values are filled in once offsets are known).
    const ptr = (owner, tag, target) => { if (byKind[target].entries.length) owner.entries.push({ tag, type: 4, count: 1, bytes: new Uint8Array(4), pointerTo: target }); };
    if (byKind.interop.entries.length && !byKind.exif.entries.length) byKind.exif.entries.push({ tag: 0xa000, type: 7, count: 4, bytes: enc.encode('0100') });
    ptr(byKind.exif, 0xa005, 'interop');
    ptr(byKind.ifd0, 0x8769, 'exif');
    ptr(byKind.ifd0, 0x8825, 'gps');
    const active = ifds.filter(i => i.entries.length);
    if (!active.length || active[0].kind !== 'ifd0') {
      if (!byKind.ifd0.entries.length) { byKind.ifd0.entries.push({ tag: 0x131, type: 2, count: 1, bytes: new Uint8Array(1) }); active.unshift(byKind.ifd0); }
    }
    let off = 8;
    for (const ifd of active) {
      ifd.entries.sort((a, b) => a.tag - b.tag);
      ifd.offset = off;
      off += 2 + 12 * ifd.entries.length + 4;
    }
    let dataOff = off;
    for (const ifd of active) for (const e of ifd.entries) if (e.bytes.length > 4) { e.dataOffset = dataOff; dataOff += e.bytes.length + (e.bytes.length & 1); }
    const out = new Uint8Array(dataOff);
    const dv = new DataView(out.buffer);
    out[0] = out[1] = little ? 0x49 : 0x4d;
    dv.setUint16(2, 42, little);
    dv.setUint32(4, 8, little);
    for (const ifd of active) {
      dv.setUint16(ifd.offset, ifd.entries.length, little);
      ifd.entries.forEach((e, i) => {
        const eo = ifd.offset + 2 + i * 12;
        dv.setUint16(eo, e.tag, little); dv.setUint16(eo + 2, e.type, little); dv.setUint32(eo + 4, e.count, little);
        if (e.pointerTo) dv.setUint32(eo + 8, byKind[e.pointerTo].offset, little);
        else if (e.bytes.length > 4) { dv.setUint32(eo + 8, e.dataOffset, little); out.set(e.bytes, e.dataOffset); }
        else out.set(e.bytes, eo + 8);
      });
    }
    return out;
  }

  /** Overwrites the Orientation value in a TIFF block in place (when the tag exists). Returns true on success. */
  function patchOrientation(tiffBytes, value) {
    const tiff = parseTiff(tiffBytes);
    const e = tiff && getEntry(tiff, 'ifd0', 'Orientation');
    if (!e || e.type !== 3) return false;
    new DataView(tiffBytes.buffer, tiffBytes.byteOffset, tiffBytes.byteLength).setUint16(e.entryOffset + 8, value, tiff.little);
    return true;
  }
  function orientationOf(u8) {
    try {
      const t = extractExifTiff(u8);
      const tiff = t && parseTiff(t);
      const e = tiff && getEntry(tiff, 'ifd0', 'Orientation');
      return e ? e.value : 1;
    } catch (err) { return 1; }
  }
  function orientationTiff(value) {
    const model = { little: true, ifd0: [], exif: [], gps: [], interop: [] };
    setEntry(model, 'ifd0', 0x112, 3, value);
    return serializeModel(model);
  }

  /* ------------------------------------------------------------------ writing: public operations */
  function toU8(buffer) { return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer); }
  function requireWritable(fmt) {
    if (!WRITABLE.has(fmt)) throw new Error(`Editing ${FORMAT_NAMES[fmt] || 'this'} files is not supported here. Use a JPEG, PNG or WebP.`);
  }

  /** Writes `tiffBytes` (or nothing, for null) as the file's EXIF block. Other metadata is left alone. */
  function setExifBlock(buffer, tiffBytes) {
    const u8 = toU8(buffer), fmt = detectFormat(u8);
    requireWritable(fmt);
    if (fmt === 'jpeg') return jpegRebuild(u8, { dropExif: true, insertExif: tiffBytes });
    if (fmt === 'png') return pngRebuild(u8, { dropExif: true, insertExif: tiffBytes });
    return webpRebuild(u8, { dropExif: true, insertExif: tiffBytes });
  }

  /**
   * Removes metadata. options: keepOrientation (default true), keepColorProfile (default true).
   * Everything else (EXIF, GPS, thumbnails, XMP, IPTC, comments, text chunks, trailing data) goes.
   */
  function stripMetadata(buffer, { keepOrientation = true, keepColorProfile = true } = {}) {
    const u8 = toU8(buffer), fmt = detectFormat(u8);
    requireWritable(fmt);
    const ori = keepOrientation ? orientationOf(u8) : 1;
    const insertExif = ori > 1 && ori <= 8 ? orientationTiff(ori) : null;
    if (fmt === 'jpeg') return jpegRebuild(u8, { dropExif: true, dropXmp: true, dropIptc: true, dropIcc: !keepColorProfile, dropComments: true, dropOther: true, dropTrailer: true, insertExif });
    if (fmt === 'png') return pngRebuild(u8, { dropExif: true, dropText: true, insertExif });
    return webpRebuild(u8, { dropExif: true, dropXmp: true, insertExif });
  }

  /** Re-draws any decodable image to a PNG/JPEG with no metadata (fallback for GIF, BMP, AVIF…). */
  async function reencode(blob, mime = 'image/png', quality = 0.95) {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not re-encode the image.'))), mime, quality));
  }

  /* ------------------------------------------------------------------ edit helpers */
  const pad = n => String(n).padStart(2, '0');
  function exifDate(local) {
    // "2026-09-14T16:42:10" (datetime-local) -> "2026:09:14 16:42:10"
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(local || '');
    return m ? `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}` : null;
  }
  function localFromExifDate(s) {
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s || '');
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : '';
  }
  function parseFraction(text) {
    const t = String(text).trim();
    const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
    if (m) { const d = parseFloat(m[2]); return d ? parseFloat(m[1]) / d : NaN; }
    const v = parseFloat(t.replace(/^f\//i, '').replace(/\s*(s|mm|m)$/i, ''));
    return v;
  }
  function setGps(model, lat, lon, altitude) {
    model.gps = [];
    if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return;
    const toDms = deg => {
      const a = Math.abs(deg);
      const d = Math.floor(a), mFull = (a - d) * 60, m = Math.floor(mFull), s = (mFull - m) * 60;
      return [[d, 1], [m, 1], [Math.round(s * 10000), 10000]];
    };
    setEntry(model, 'gps', 0, 1, [2, 3, 0, 0]);
    setEntry(model, 'gps', 1, 2, lat < 0 ? 'S' : 'N');
    setEntry(model, 'gps', 2, 5, toDms(lat));
    setEntry(model, 'gps', 3, 2, lon < 0 ? 'W' : 'E');
    setEntry(model, 'gps', 4, 5, toDms(lon));
    if (altitude != null && !Number.isNaN(altitude)) {
      setEntry(model, 'gps', 5, 1, [altitude < 0 ? 1 : 0]);
      setEntry(model, 'gps', 6, 5, [[Math.round(Math.abs(altitude) * 100), 100]]);
    }
  }

  /* ------------------------------------------------------------------ extraction formats */
  function toPlainObject(meta, fileName) {
    const obj = { file: { name: fileName || null, format: meta.formatName, bytes: meta.size } };
    for (const g of meta.groups) {
      obj[g.title] = {};
      for (const r of g.rows) obj[g.title][r.name] = r.value;
    }
    if (meta.gps) obj.location = { latitude: +meta.gps.lat.toFixed(6), longitude: +meta.gps.lon.toFixed(6), altitude: meta.gps.altitude };
    return obj;
  }
  const csvCell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function toCsv(items) {
    // items: [{ name, meta }] -> long format, one row per tag
    const lines = ['file,group,tag,value'];
    for (const { name, meta } of items) for (const g of meta.groups) for (const r of g.rows) lines.push([name, g.title, r.name, r.value].map(csvCell).join(','));
    return lines.join('\n');
  }
  function toText(meta, fileName) {
    const lines = [];
    if (fileName) lines.push(fileName, '='.repeat(fileName.length), '');
    for (const g of meta.groups) {
      lines.push(g.title.toUpperCase(), '-'.repeat(g.title.length));
      const w = Math.min(34, Math.max(...g.rows.map(r => r.name.length)));
      for (const r of g.rows) lines.push(`${r.name.padEnd(w)}  ${r.value}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ ZIP (store-only) */
  function makeZip(files) {
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const u16 = n => new Uint8Array([n & 255, n >> 8 & 255]);
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data);
      const local = concat([u32le(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32le(crc), u32le(f.data.length), u32le(f.data.length), u16(name.length), u16(0), name]);
      parts.push(local, f.data);
      central.push(concat([u32le(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32le(crc), u32le(f.data.length), u32le(f.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32le(0), u32le(offset), name]));
      offset += local.length + f.data.length;
    }
    const cd = concat(central);
    const end = concat([u32le(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32le(cd.length), u32le(offset), u16(0)]);
    return new Blob([...parts, cd, end], { type: 'application/zip' });
  }

  window.ExifCore = {
    readMetadata, detectFormat, extractExifTiff, parseTiff, getEntry, formatEntry, humanize,
    stripMetadata, setExifBlock, reencode,
    toModel, cloneModel, setEntry, removeEntry, serializeModel, encodeEntry, patchOrientation, orientationOf, orientationTiff,
    exifDate, localFromExifDate, parseFraction, setGps, toRational,
    toPlainObject, toCsv, toText, makeZip, crc32,
    WRITABLE, FORMAT_NAMES, NAME_TO_TAG, TAGS
  };
})();
