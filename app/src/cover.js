/**
 * Neon Coast Cover Studio — cover renderer (cover.js)
 *
 * Pure ES module, no dependencies, no network. Draws a GTA-style poster
 * cover on any canvas: sky gradient base, cover-fit photos per panel,
 * colour grade tint, sun disc, palm silhouettes, big Anton title with a
 * Pacifico subtitle, thin white inner frame, optional film grain and
 * vignette.
 *
 * Contract (used by main.js / shots.js — do not rename):
 *   LAYOUTS   { hero, duo, trio, grid4, grid9, tilt } — unit coords 0..1
 *   GRADES    { sunset, neon, vice, mono, teal } — { sky, tint, caption }
 *   drawCover(canvas, state) -> Promise<canvas>
 *   renderCover(state, w, h) -> Promise<canvas> (offscreen, for export)
 *
 * state = {
 *   layout, grade,                       // keys into LAYOUTS / GRADES
 *   panels: [{ img, px, py, scale }],    // img: Image|null, px/py 0..1,
 *                                         // scale 1 = cover-fit
 *   title, subtitle,                     // strings
 *   titleColor,                          // 'white' | 'sunset' | 'neon' | 'gold'
 *   titlePos,                            // 'top' | 'bottom'
 *   grain, vignette,                     // booleans
 * }
 */

/* ------------------------------------------------------------------ */
/* Layouts — panels in unit coordinates (0..1). Multi-panel layouts leave
   a 0.012 white seam between panels (panel widths already account for it). */
/* ------------------------------------------------------------------ */

export const LAYOUTS = {
  hero: {
    name: 'Hero',
    panels: [
      { x: 0, y: 0, w: 1, h: 1 },
    ],
  },
  duo: {
    name: 'Duo',
    panels: [
      { x: 0, y: 0, w: 0.494, h: 1 },
      { x: 0.506, y: 0, w: 0.494, h: 1 },
    ],
  },
  trio: {
    name: 'Trio',
    panels: [
      { x: 0, y: 0, w: 1, h: 0.58 },
      { x: 0, y: 0.592, w: 0.494, h: 0.408 },
      { x: 0.506, y: 0.592, w: 0.494, h: 0.408 },
    ],
  },
  grid4: {
    name: 'Grid 4',
    panels: [
      { x: 0, y: 0, w: 0.494, h: 0.494 },
      { x: 0.506, y: 0, w: 0.494, h: 0.494 },
      { x: 0, y: 0.506, w: 0.494, h: 0.494 },
      { x: 0.506, y: 0.506, w: 0.494, h: 0.494 },
    ],
  },
  grid9: {
    name: 'Grid 9',
    // 3x3 cells with 0.012 white seams, built programmatically.
    panels: Array.from({ length: 9 }, (_, i) => ({
      x: (i % 3) * 0.3373,
      y: Math.floor(i / 3) * 0.3373,
      w: 0.3253,
      h: 0.3253,
    })),
  },
  tilt: {
    name: 'Tilt',
    panels: [
      // Big centre print, slightly tilted; two smaller prints overlap
      // it at the bottom corners. Polaroid-style white borders.
      { x: 0.2, y: 0.05, w: 0.6, h: 0.62, rot: -0.04 },
      { x: 0.04, y: 0.58, w: 0.42, h: 0.37, rot: 0.05 },
      { x: 0.54, y: 0.6, w: 0.42, h: 0.35, rot: -0.03 },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Grades — sky: [top, bottom] gradient stops; tint: bottom-up wash  */
/* laid over the photos; caption: the subtitle accent colour.        */
/* ------------------------------------------------------------------ */

export const GRADES = {
  sunset: {
    sky: ['#ff9a3c', '#ff2e88'],
    tint: 'rgba(255,110,60,0.28)',
    caption: '#ffffff',
  },
  neon: {
    sky: ['#ff2e88', '#3b0a5e'],
    tint: 'rgba(255,46,136,0.30)',
    caption: '#ffffff',
  },
  vice: {
    sky: ['#7b2ff7', '#f5c542'],
    tint: 'rgba(120,60,220,0.26)',
    caption: '#ffd166',
  },
  mono: {
    sky: ['#d9d9d9', '#3a3a3a'],
    tint: 'rgba(0,0,0,0.25)',
    caption: '#ffffff',
  },
  teal: {
    sky: ['#00c2cb', '#0b2a6b'],
    tint: 'rgba(0,180,200,0.26)',
    caption: '#ffffff',
  },
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                      */
/* ------------------------------------------------------------------ */

/** Deterministic PRNG (mulberry32) — fixed seed keeps grain identical. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Resolve a layout key (or a raw layout object) to a layout + its key. */
function resolveLayout(layout) {
  if (layout && typeof layout === 'object' && Array.isArray(layout.panels)) {
    return { key: layout.name || 'custom', layout };
  }
  if (typeof layout === 'string' && LAYOUTS[layout]) {
    return { key: layout, layout: LAYOUTS[layout] };
  }
  return { key: 'hero', layout: LAYOUTS.hero };
}

/** Resolve a grade key (or a raw grade object) to a grade + its key. */
function resolveGrade(grade) {
  if (grade && typeof grade === 'object' && Array.isArray(grade.sky)) {
    return { key: 'custom', grade };
  }
  if (typeof grade === 'string' && GRADES[grade]) {
    return { key: grade, grade: GRADES[grade] };
  }
  return { key: 'sunset', grade: GRADES.sunset };
}

/** Load the poster fonts before drawing; fall back silently if absent. */
async function ensureFonts() {
  try {
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load('16px Anton'),
        document.fonts.load('16px Pacifico'),
      ]);
    }
  } catch {
    /* System fallback fonts will be used instead. */
  }
}

/* ------------------------------------------------------------------ */
/* Panels — sky base, cover-fit photo (or placeholder), tint wash     */
/* ------------------------------------------------------------------ */

/**
 * Draw one photo cover-fit inside a pw x ph box (panel-local coords).
 * px/py (0..1) place the photo centre; scale magnifies from cover-fit.
 * The pan is clamped so the photo never exposes the panel background.
 */
function drawPhoto(ctx, img, panel, pw, ph, gradeKey) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(pw / iw, ph / ih) * (panel.scale || 1);
  const dw = iw * scale;
  const dh = ih * scale;
  const px = panel.px == null ? 0.5 : panel.px;
  const py = panel.py == null ? 0.5 : panel.py;
  let dx = pw * px - dw / 2;
  let dy = ph * py - dh / 2;
  dx = clamp(dx, pw - dw, 0);
  dy = clamp(dy, ph - dh, 0);
  if (gradeKey === 'mono') ctx.filter = 'grayscale(1)';
  ctx.drawImage(img, dx, dy, dw, dh);
  if (gradeKey === 'mono') ctx.filter = 'none';
}

/** Empty panel: dark base, diagonal stripes, "DROP PHOTO". */
function drawPlaceholder(ctx, pw, ph, grade) {
  const base = ctx.createLinearGradient(0, 0, pw, ph);
  base.addColorStop(0, '#241a33');
  base.addColorStop(1, '#0c0912');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, pw, ph);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = Math.max(2, pw * 0.01);
  const step = Math.max(28, pw * 0.12);
  for (let d = -ph; d < pw + ph; d += step) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + ph, ph);
    ctx.stroke();
  }
  ctx.restore();
  const size = Math.max(12, Math.round(pw * 0.075));
  ctx.font = `${size}px Anton, "Arial Narrow", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = grade.caption || '#ffffff';
  ctx.globalAlpha = 0.75;
  ctx.fillText('DROP PHOTO', pw / 2, ph / 2);
  ctx.globalAlpha = 1;
}

/** Draw one layout panel (rotated + white-bordered for tilt). */
function drawPanel(ctx, def, panelState, grade, gradeKey, W, H) {
  const px = def.x * W;
  const py = def.y * H;
  const pw = def.w * W;
  const ph = def.h * H;
  const rot = def.rot || 0;
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  ctx.save();
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot);
  ctx.translate(-pw / 2, -ph / 2);
  if (rot) {
    // Polaroid white border + soft drop shadow.
    const pad = Math.max(6, W * 0.012);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = W * 0.02;
    ctx.shadowOffsetY = W * 0.008;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-pad, -pad, pw + pad * 2, ph + pad * 2);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
  ctx.beginPath();
  ctx.rect(0, 0, pw, ph);
  ctx.clip();
  // Sky gradient as the panel base.
  const sky = ctx.createLinearGradient(0, 0, 0, ph);
  sky.addColorStop(0, grade.sky[0]);
  sky.addColorStop(1, grade.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, pw, ph);
  const img = panelState && panelState.img ? panelState.img : null;
  if (img) drawPhoto(ctx, img, panelState, pw, ph, gradeKey);
  else drawPlaceholder(ctx, pw, ph, grade);
  // Tint wash, fading from the bottom up.
  const tint = ctx.createLinearGradient(0, ph, 0, 0);
  tint.addColorStop(0, grade.tint);
  tint.addColorStop(0.65, 'rgba(0,0,0,0)');
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, pw, ph);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Decorations — sun, palms, title block, frame, grain, vignette      */
/* ------------------------------------------------------------------ */

/** Sun disc with a soft halo, parked near the title zone. */
function drawSun(ctx, gradeKey, W, H, titlePos) {
  const r = Math.min(W, H) * 0.085;
  const x = W * 0.8;
  const y = titlePos === 'top' ? H * 0.2 : H * 0.72;
  const mono = gradeKey === 'mono';
  const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 3.2);
  halo.addColorStop(0, mono ? 'rgba(255,255,255,0.55)' : 'rgba(255,214,140,0.55)');
  halo.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();
  const disc = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, r * 0.1, x, y, r);
  if (mono) {
    disc.addColorStop(0, '#ffffff');
    disc.addColorStop(1, '#9a9a9a');
  } else {
    disc.addColorStop(0, '#fff8dc');
    disc.addColorStop(0.55, '#ffd166');
    disc.addColorStop(1, '#ff7a3c');
  }
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** One palm silhouette: curved trunk + six drooping fronds. */
function drawPalm(ctx, bx, by, h, lean) {
  const topX = bx + lean;
  const topY = by - h;
  const bw = h * 0.045;
  ctx.fillStyle = '#0b0b10';
  // Tapered, curving trunk.
  ctx.beginPath();
  ctx.moveTo(bx - bw, by);
  ctx.quadraticCurveTo(bx - bw * 0.4 + lean * 0.4, by - h * 0.55, topX - bw * 0.28, topY);
  ctx.lineTo(topX + bw * 0.28, topY);
  ctx.quadraticCurveTo(bx + bw * 0.4 + lean * 0.4, by - h * 0.55, bx + bw, by);
  ctx.closePath();
  ctx.fill();
  // Six fronds fanning out from the crown and drooping down. Each blade
  // is a filled shape: an outer edge that sags low and an inner edge
  // that stays higher, so the leaf is wide in the middle, pointed at
  // the tip, and narrow where it joins the crown.
  const dirs = [
    [-1.0, 0.15],
    [-0.85, -0.45],
    [-0.45, -0.75],
    [0.45, -0.75],
    [0.85, -0.45],
    [1.0, 0.15],
  ];
  for (const [dx, dy] of dirs) {
    const len = h * (Math.abs(dx) > 0.9 ? 0.46 : 0.38);
    const tipX = topX + dx * len;
    const tipY = topY + dy * len;
    const outerX = topX + dx * len * 0.55;
    const outerY = topY + dy * len * 0.55 + len * 0.38;
    const innerX = topX + dx * len * 0.45;
    const innerY = topY + dy * len * 0.45 + len * 0.04;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(outerX, outerY, tipX, tipY);
    ctx.quadraticCurveTo(innerX, innerY, topX, topY);
    ctx.closePath();
    ctx.fill();
  }
}

/** Fill for the title text, by titleColor. */
function titleFill(ctx, color, y0, y1) {
  const grad = ctx.createLinearGradient(0, y0, 0, y1);
  if (color === 'sunset') {
    grad.addColorStop(0, '#ffb347');
    grad.addColorStop(0.5, '#ff7a3c');
    grad.addColorStop(1, '#ff2e88');
  } else if (color === 'neon') {
    grad.addColorStop(0, '#ff7ad9');
    grad.addColorStop(0.5, '#ff2e88');
    grad.addColorStop(1, '#a855f7');
  } else if (color === 'gold') {
    grad.addColorStop(0, '#fff3c4');
    grad.addColorStop(0.5, '#f5c542');
    grad.addColorStop(1, '#d99a1f');
  } else {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#ffffff');
  }
  return grad;
}

/** Title (Anton, fitted to the canvas width) + subtitle (Pacifico). */
function drawTitleBlock(ctx, state, grade, W, H) {
  const title = (state.title || '').trim().toUpperCase();
  const subtitle = (state.subtitle || '').trim();
  if (!title && !subtitle) return;
  const pad = Math.round(H * 0.045);
  const cx = W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Fit the title: start at 11% of the width, shrink until it fits 92%.
  let size = Math.round(W * 0.11);
  if (title) {
    ctx.font = `${size}px Anton, "Arial Narrow", sans-serif`;
    const minSize = Math.round(W * 0.03);
    while (size > minSize && ctx.measureText(title).width > W * 0.92) {
      size = Math.round(size * 0.92);
      ctx.font = `${size}px Anton, "Arial Narrow", sans-serif`;
    }
  }
  const subSize = Math.max(10, Math.round(size * 0.38));
  const top = state.titlePos === 'top';
  let titleBase;
  let subBase;
  if (top) {
    titleBase = pad + size;
    subBase = title ? titleBase + Math.round(subSize * 1.6) : pad + subSize;
  } else {
    titleBase = H - pad;
    subBase = title ? titleBase - Math.round(size * 1.05) : H - pad;
  }
  if (subtitle) {
    ctx.font = `${subSize}px Pacifico, cursive`;
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = Math.round(subSize * 0.25);
    ctx.shadowOffsetY = Math.round(subSize * 0.08);
    ctx.fillStyle = grade.caption === '#ffd166' ? '#ffe9a8' : '#ffe9f4';
    ctx.fillText(subtitle, cx, subBase);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
  if (title) {
    ctx.font = `${size}px Anton, "Arial Narrow", sans-serif`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size * 0.06);
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = Math.round(size * 0.08);
    ctx.shadowOffsetY = Math.round(size * 0.03);
    ctx.strokeText(title, cx, titleBase);
    ctx.fillStyle = titleFill(ctx, state.titleColor || 'white', titleBase - size, titleBase);
    ctx.fillText(title, cx, titleBase);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }
}

/** Thin white inner frame around the whole cover. */
function drawFrame(ctx, W, H) {
  const inset = Math.round(W * 0.015);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = Math.max(2, Math.round(W * 0.006));
  ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  ctx.restore();
}

/** Film grain: 2500 seeded 1px dots, so every export is identical. */
function drawGrain(ctx, W, H) {
  const rand = mulberry32(20261119);
  for (let i = 0; i < 2500; i += 1) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H);
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(x, y, 1, 1);
  }
}

/** Radial darkening toward the corners (0.35 at the edges). */
function drawVignette(ctx, W, H) {
  const radius = Math.hypot(W, H) / 2;
  const grad = ctx.createRadialGradient(W / 2, H / 2, radius * 0.55, W / 2, H / 2, radius);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Draw the whole cover on the given canvas (any size). Async because the
 * poster fonts are loaded first; callers should await it.
 */
export async function drawCover(canvas, state = {}) {
  await ensureFonts();
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const { layout } = resolveLayout(state.layout);
  const { key: gradeKey, grade } = resolveGrade(state.grade);
  const panelStates = Array.isArray(state.panels) ? state.panels : [];
  const titlePos = state.titlePos === 'top' ? 'top' : 'bottom';
  const isTilt = layout === LAYOUTS.tilt;

  // Base: tilt shows the sky between the overlapping prints; every other
  // layout starts white so the 0.012 seams read as clean white gaps.
  if (isTilt) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, grade.sky[0]);
    sky.addColorStop(1, grade.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
  }

  // Panels: sky base, photo (or placeholder), tint wash.
  layout.panels.forEach((def, i) => {
    drawPanel(ctx, def, panelStates[i] || {}, grade, gradeKey, W, H);
  });

  // Gentle darkening at the top so the title zone always reads.
  const topShade = ctx.createLinearGradient(0, 0, 0, H * 0.3);
  topShade.addColorStop(0, 'rgba(0,0,0,0.16)');
  topShade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topShade;
  ctx.fillRect(0, 0, W, H * 0.3);

  // Decorations.
  drawSun(ctx, gradeKey, W, H, titlePos);
  drawPalm(ctx, W * 0.045, H * 0.985, H * 0.3, W * 0.03);
  drawPalm(ctx, W * 0.95, H * 0.985, H * 0.2, -W * 0.02);
  drawTitleBlock(ctx, state, grade, W, H);
  drawFrame(ctx, W, H);
  if (state.grain) drawGrain(ctx, W, H);
  if (state.vignette) drawVignette(ctx, W, H);
  return canvas;
}

/**
 * Render the cover on a fresh offscreen canvas of the given size and
 * return it (for PNG export / download).
 */
export async function renderCover(state, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  await drawCover(canvas, state);
  return canvas;
}
