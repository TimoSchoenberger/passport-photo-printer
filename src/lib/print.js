const MM_PER_INCH = 25.4;
const EPSILON = 1e-8;

/** Place physical-size photographs on a sheet. No scaling is used to make them fit. */
export function calculateLayout({
  photoWidth = 35,
  photoHeight = 45,
  paperWidth = 150,
  paperHeight = 100,
  copies = 8,
  gap = 2,
  margin = 2,
} = {}) {
  const base = {
    valid: false, error: '', capacity: 0, cols: 0, rows: 0,
    rotated: false, placements: [], paperWidth, paperHeight,
  };
  const dimensions = [photoWidth, photoHeight, paperWidth, paperHeight];
  if (dimensions.some((value) => !Number.isFinite(value) || value < 1 || value > 1000)) {
    return { ...base, error: 'Photo and paper dimensions must be between 1 and 1,000 mm.' };
  }
  if (![gap, margin].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
    return { ...base, error: 'Spacing and margins must be between 0 and 100 mm.' };
  }
  if (!Number.isInteger(copies) || copies < 1 || copies > 100) {
    return { ...base, error: 'Choose between 1 and 100 copies.' };
  }

  const availableWidth = paperWidth - 2 * margin;
  const availableHeight = paperHeight - 2 * margin;
  const candidates = [false, true].map((rotated) => {
    const width = rotated ? photoHeight : photoWidth;
    const height = rotated ? photoWidth : photoHeight;
    const cols = Math.max(0, Math.floor((availableWidth + gap + EPSILON) / (width + gap)));
    const rows = Math.max(0, Math.floor((availableHeight + gap + EPSILON) / (height + gap)));
    return { width, height, cols, rows, rotated, capacity: cols * rows };
  });
  // An equal-capacity layout stays upright, including the default 4 × 2 sheet.
  const chosen = candidates[1].capacity > candidates[0].capacity ? candidates[1] : candidates[0];
  const { width, height, rotated, capacity } = chosen;
  if (capacity < copies) {
    const error = capacity === 0
      ? 'This photo size does not fit the paper with the selected margins.'
      : `Only ${capacity} ${capacity === 1 ? 'copy fits' : 'copies fit'} at this size. Reduce the copies, spacing or margins, or choose larger paper.`;
    return { ...base, error, capacity, rotated, cols: chosen.cols, rows: chosen.rows };
  }

  const cols = Math.min(chosen.cols, copies);
  const rows = Math.ceil(copies / cols);
  const top = (paperHeight - (rows * height + (rows - 1) * gap)) / 2;
  const placements = [];
  for (let row = 0; row < rows; row += 1) {
    const rowCopies = Math.min(cols, copies - row * cols);
    const left = (paperWidth - (rowCopies * width + (rowCopies - 1) * gap)) / 2;
    for (let col = 0; col < rowCopies; col += 1) {
      placements.push({
        x: left + col * (width + gap), y: top + row * (height + gap),
        width, height, rotate: rotated,
      });
    }
  }
  return { ...base, valid: true, capacity, cols, rows, rotated, placements };
}

function sourceRectangle(source, width, height) {
  const targetRatio = width / height;
  if (source.width / source.height > targetRatio) {
    const cropWidth = source.height * targetRatio;
    return [(source.width - cropWidth) / 2, 0, cropWidth, source.height];
  }
  const cropHeight = source.width / targetRatio;
  return [0, (source.height - cropHeight) / 2, source.width, cropHeight];
}

function drawCutMarks(context, layout) {
  const clearance = 0.3;
  const length = 1.2;
  const strokePadding = 0.08;
  context.strokeStyle = '#777777';
  context.lineWidth = 0.1;
  context.lineCap = 'butt';
  context.beginPath();
  const seen = new Set();
  const addLine = (x1, y1, x2, y2) => {
    // Clip to the physical paper edge, not an individual photo edge.
    x1 = Math.max(strokePadding, Math.min(layout.paperWidth - strokePadding, x1));
    x2 = Math.max(strokePadding, Math.min(layout.paperWidth - strokePadding, x2));
    y1 = Math.max(strokePadding, Math.min(layout.paperHeight - strokePadding, y1));
    y2 = Math.max(strokePadding, Math.min(layout.paperHeight - strokePadding, y2));
    if (Math.hypot(x2 - x1, y2 - y1) < 0.2) return;
    const minX = Math.min(x1, x2) - strokePadding;
    const maxX = Math.max(x1, x2) + strokePadding;
    const minY = Math.min(y1, y2) - strokePadding;
    const maxY = Math.max(y1, y2) + strokePadding;
    // Omit any mark that would touch another photograph, including partial rows.
    if (layout.placements.some((p) => maxX > p.x && minX < p.x + p.width
      && maxY > p.y && minY < p.y + p.height)) return;
    const key = [x1, y1, x2, y2].map((n) => n.toFixed(4)).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
  };
  for (const p of layout.placements) {
    for (const x of [p.x, p.x + p.width]) {
      addLine(x, p.y - clearance - length, x, p.y - clearance);
      addLine(x, p.y + p.height + clearance, x, p.y + p.height + clearance + length);
    }
    for (const y of [p.y, p.y + p.height]) {
      addLine(p.x - clearance - length, y, p.x - clearance, y);
      addLine(p.x + p.width + clearance, y, p.x + p.width + clearance + length, y);
    }
  }
  context.stroke();
}

/** Render an exact-size sheet. All placement coordinates are millimetres. */
export function renderSheet(cropCanvas, layout, { dpi = 300, cutMarks = true } = {}) {
  if (!layout?.valid || !layout.placements?.length) throw new Error(layout?.error || 'Choose a valid print layout first.');
  if (!cropCanvas?.width || !cropCanvas?.height) throw new Error('Select and crop a photo first.');
  if (!Number.isFinite(dpi) || dpi < 72 || dpi > 1200) throw new Error('Print resolution must be between 72 and 1,200 DPI.');
  const width = Math.round(layout.paperWidth / MM_PER_INCH * dpi);
  const height = Math.round(layout.paperHeight / MM_PER_INCH * dpi);
  if (width * height > 64_000_000 || width > 32767 || height > 32767) {
    throw new Error('This sheet is too large to render. Choose smaller paper or a lower resolution.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create the print preview.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  // Use each rounded page dimension independently so physical placement spans
  // exactly the exported page, without accumulating pixel-rounding errors.
  context.setTransform(width / layout.paperWidth, 0, 0, height / layout.paperHeight, 0, 0);
  for (const p of layout.placements) {
    const drawWidth = p.rotate ? p.height : p.width;
    const drawHeight = p.rotate ? p.width : p.height;
    const source = sourceRectangle(cropCanvas, drawWidth, drawHeight);
    context.save();
    context.translate(p.x + p.width / 2, p.y + p.height / 2);
    if (p.rotate) context.rotate(Math.PI / 2);
    context.drawImage(cropCanvas, ...source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    context.restore();
  }
  if (cutMarks) drawCutMarks(context, layout);
  return canvas;
}

/** Return JPEG bytes with JFIF density in dots per inch, preserving image data. */
export function setJpegDpi(input, dpi = 300) {
  if (!Number.isInteger(dpi) || dpi < 1 || dpi > 65535) throw new Error('JPEG DPI must be an integer between 1 and 65,535.');
  const bytes = Uint8Array.from(input instanceof Uint8Array ? input : new Uint8Array(input));
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('The browser did not return a JPEG image.');
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    // JPEG permits padding bytes before a marker.
    while (bytes[offset + 1] === 0xff) offset += 1;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    if (marker === 0xe0 && length >= 16
      && bytes[offset + 4] === 0x4a && bytes[offset + 5] === 0x46
      && bytes[offset + 6] === 0x49 && bytes[offset + 7] === 0x46
      && bytes[offset + 8] === 0) {
      bytes[offset + 11] = 1; // 1 = dots per inch; 2 would be dots per centimetre.
      bytes[offset + 12] = dpi >> 8;
      bytes[offset + 13] = dpi & 0xff;
      bytes[offset + 14] = dpi >> 8;
      bytes[offset + 15] = dpi & 0xff;
      return bytes;
    }
    offset += length + 2;
  }
  const jfif = new Uint8Array([
    0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0,
    1, 1, 1, dpi >> 8, dpi & 0xff, dpi >> 8, dpi & 0xff, 0, 0,
  ]);
  const result = new Uint8Array(bytes.length + jfif.length);
  result.set(bytes.subarray(0, 2));
  result.set(jfif, 2);
  result.set(bytes.subarray(2), 2 + jfif.length);
  return result;
}

export async function canvasToJpeg(canvas, dpi = 300) {
  const jpeg = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not export this image. Try a smaller paper size.')), 'image/jpeg', 0.98);
  });
  return new Blob([setJpegDpi(await jpeg.arrayBuffer(), dpi)], { type: 'image/jpeg' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // A delayed revoke lets browsers finish accepting the download first.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadPdf(canvas, layout, filename = 'passport-photos.pdf') {
  if (!layout?.valid) throw new Error(layout?.error || 'Choose a valid print layout first.');
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation: layout.paperWidth >= layout.paperHeight ? 'landscape' : 'portrait',
    unit: 'mm', format: [layout.paperWidth, layout.paperHeight],
    compress: true, precision: 8,
  });
  pdf.setProperties({ title: 'Passport photo print sheet', creator: 'Passport Photo Printer' });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, layout.paperWidth, layout.paperHeight, undefined, 'FAST');
  await pdf.save(filename, { returnPromise: true });
}
