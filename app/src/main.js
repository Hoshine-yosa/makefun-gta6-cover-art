/**
 * Neon Coast Cover Studio — wiring (main.js)
 *
 * Binds the controls in index.html to the renderer in cover.js:
 * panel photo pickers, layout / grade pickers, caption inputs,
 * canvas drag-to-pan + scroll-to-zoom, drag-and-drop, PNG export,
 * and the ?shot= fixed scenes (see shots.js) used for screenshots.
 */

import { LAYOUTS, GRADES, drawCover, renderCover } from './cover.js';
import { runShot } from './shots.js';

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const state = {
  layout: 'grid4',
  grade: 'sunset',
  panels: [],
  title: 'Neon Coast',
  subtitle: 'Vice City nights',
  titleColor: 'white',
  titlePos: 'bottom',
  grain: true,
  vignette: true,
};

/** Index of the panel the canvas gestures act on. */
let selectedIndex = 0;

/** Rebuild state.panels for a layout, reusing existing images in order. */
function buildPanels(layoutKey) {
  const count = LAYOUTS[layoutKey].panels.length;
  const old = state.panels;
  state.panels = Array.from({ length: count }, (_, i) => ({
    img: old[i] ? old[i].img : null,
    px: old[i] && old[i].px != null ? old[i].px : 0.5,
    py: old[i] && old[i].py != null ? old[i].py : 0.5,
    scale: old[i] && old[i].scale ? old[i].scale : 1,
  }));
  if (selectedIndex >= count) selectedIndex = 0;
}

buildPanels(state.layout);

/* ------------------------------------------------------------------ */
/* DOM                                                                 */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const canvas = $('cover');
const panelList = $('panelList');
const layoutPicker = $('layoutPicker');
const gradePicker = $('gradePicker');
const titleInput = $('titleInput');
const subtitleInput = $('subtitleInput');
const titleColor = $('titleColor');
const titlePos = $('titlePos');
const grainToggle = $('grainToggle');
const vignetteToggle = $('vignetteToggle');
const exportSize = $('exportSize');
const exportBtn = $('exportBtn');
const status = $('status');
const dropzone = $('dropzone');

/** Load an image from a URL (or object URL); rejects on error. */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image: ' + url));
    img.src = url;
  });
}

/** Set a panel's image from a File object (file input / drag-and-drop). */
async function setPanelImageFromFile(index, file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    state.panels[index].img = img;
    selectedIndex = index;
    await redraw();
  } catch (err) {
    status.textContent = 'Could not load that image.';
    console.error(err);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------------ */
/* Redraw + selection highlight                                        */
/* ------------------------------------------------------------------ */

/** Redraw the cover, then outline the selected panel with a pink dash. */
async function redraw() {
  await drawCover(canvas, state);
  const defs = LAYOUTS[state.layout].panels;
  const def = defs[selectedIndex];
  if (!def) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.save();
  ctx.strokeStyle = '#ff2e88';
  ctx.lineWidth = Math.max(3, Math.round(W * 0.003));
  ctx.setLineDash([Math.round(W * 0.02), Math.round(W * 0.012)]);
  ctx.strokeRect(def.x * W + 2, def.y * H + 2, def.w * W - 4, def.h * H - 4);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Panel list                                                          */
/* ------------------------------------------------------------------ */

function buildPanelList() {
  panelList.textContent = '';
  state.panels.forEach((panel, i) => {
    const row = document.createElement('div');
    row.className = 'panel-row';
    row.dataset.index = String(i);

    const label = document.createElement('span');
    label.textContent = 'Panel ' + (i + 1);
    row.appendChild(label);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.setAttribute('aria-label', 'Photo for panel ' + (i + 1));
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) {
        setPanelImageFromFile(i, fileInput.files[0]);
      }
      fileInput.value = '';
    });
    row.appendChild(fileInput);

    const sample = document.createElement('select');
    sample.setAttribute('aria-label', 'Sample photo for panel ' + (i + 1));
    for (const [value, text] of [
      ['', '— sample —'],
      ['boulevard', 'Boulevard'],
      ['pier', 'Pier'],
    ]) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      sample.appendChild(opt);
    }
    sample.addEventListener('change', async () => {
      if (!sample.value) return;
      try {
        const img = await loadImage('./samples/' + sample.value + '.jpg');
        state.panels[i].img = img;
        selectedIndex = i;
        await redraw();
      } catch (err) {
        status.textContent = 'Could not load the sample photo.';
        console.error(err);
      }
      sample.value = '';
    });
    row.appendChild(sample);

    const fitBtn = document.createElement('button');
    fitBtn.type = 'button';
    fitBtn.textContent = 'Fit';
    fitBtn.addEventListener('click', async () => {
      state.panels[i].px = 0.5;
      state.panels[i].py = 0.5;
      state.panels[i].scale = 1;
      selectedIndex = i;
      await redraw();
    });
    row.appendChild(fitBtn);

    row.addEventListener('click', () => {
      selectedIndex = i;
      redraw();
    });
    panelList.appendChild(row);
  });
}

/* ------------------------------------------------------------------ */
/* Layout / grade pickers                                              */
/* ------------------------------------------------------------------ */

function buildPickers() {
  layoutPicker.textContent = '';
  for (const [key, layout] of Object.entries(LAYOUTS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = layout.name;
    btn.dataset.layout = key;
    if (key === state.layout) btn.classList.add('active');
    btn.addEventListener('click', async () => {
      state.layout = key;
      buildPanels(key);
      buildPanelList();
      syncPickerActive();
      await redraw();
    });
    layoutPicker.appendChild(btn);
  }

  gradePicker.textContent = '';
  for (const key of Object.keys(GRADES)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = key.charAt(0).toUpperCase() + key.slice(1);
    btn.dataset.grade = key;
    if (key === state.grade) btn.classList.add('active');
    btn.addEventListener('click', async () => {
      state.grade = key;
      syncPickerActive();
      await redraw();
    });
    gradePicker.appendChild(btn);
  }
}

function syncPickerActive() {
  layoutPicker.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.layout === state.layout);
  });
  gradePicker.querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.grade === state.grade);
  });
}

/* ------------------------------------------------------------------ */
/* Caption / finish controls                                           */
/* ------------------------------------------------------------------ */

titleInput.addEventListener('input', () => {
  state.title = titleInput.value;
  redraw();
});
subtitleInput.addEventListener('input', () => {
  state.subtitle = subtitleInput.value;
  redraw();
});
titleColor.addEventListener('change', () => {
  state.titleColor = titleColor.value;
  redraw();
});
titlePos.addEventListener('change', () => {
  state.titlePos = titlePos.value;
  redraw();
});
grainToggle.addEventListener('change', () => {
  state.grain = grainToggle.checked;
  redraw();
});
vignetteToggle.addEventListener('change', () => {
  state.vignette = vignetteToggle.checked;
  redraw();
});

/* ------------------------------------------------------------------ */
/* Canvas interaction: click to select, drag to pan, wheel to zoom     */
/* ------------------------------------------------------------------ */

/** Canvas pixel coords of a pointer event (canvas space, not CSS). */
function eventCanvasPos(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

/** Index of the panel containing a canvas point (topmost last), or -1. */
function panelAt(x, y) {
  const defs = LAYOUTS[state.layout].panels;
  for (let i = defs.length - 1; i >= 0; i -= 1) {
    const def = defs[i];
    if (
      x >= def.x * canvas.width &&
      x < (def.x + def.w) * canvas.width &&
      y >= def.y * canvas.height &&
      y < (def.y + def.h) * canvas.height
    ) {
      return i;
    }
  }
  return -1;
}

let dragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('pointerdown', (event) => {
  const pos = eventCanvasPos(event);
  const hit = panelAt(pos.x, pos.y);
  if (hit === -1) return;
  selectedIndex = hit;
  dragging = true;
  lastX = pos.x;
  lastY = pos.y;
  canvas.setPointerCapture(event.pointerId);
  redraw();
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const pos = eventCanvasPos(event);
  const def = LAYOUTS[state.layout].panels[selectedIndex];
  const panel = state.panels[selectedIndex];
  if (!def || !panel) return;
  // Pixel movement -> normalised centre movement (panel-local units).
  panel.px = Math.min(1, Math.max(0, panel.px + (pos.x - lastX) / (def.w * canvas.width)));
  panel.py = Math.min(1, Math.max(0, panel.py + (pos.y - lastY) / (def.h * canvas.height)));
  lastX = pos.x;
  lastY = pos.y;
  redraw();
});

function endDrag() {
  dragging = false;
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const panel = state.panels[selectedIndex];
    if (!panel) return;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    panel.scale = Math.min(4, Math.max(1, (panel.scale || 1) * factor));
    redraw();
  },
  { passive: false },
);

/* ------------------------------------------------------------------ */
/* Drag-and-drop                                                       */
/* ------------------------------------------------------------------ */

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
});
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer && event.dataTransfer.files
    ? event.dataTransfer.files[0]
    : null;
  if (file) setPanelImageFromFile(selectedIndex || 0, file);
});

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

exportBtn.addEventListener('click', async () => {
  const [w, h] = exportSize.value.split('x').map(Number);
  exportBtn.disabled = true;
  status.textContent = 'Exporting…';
  try {
    const out = await renderCover(state, w, h);
    const blob = await new Promise((resolve, reject) => {
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neon-coast-${w}x${h}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.textContent = `Saved neon-coast-${w}x${h}.png`;
  } catch (err) {
    status.textContent = 'Export failed.';
    console.error(err);
  } finally {
    exportBtn.disabled = false;
  }
});

/* ------------------------------------------------------------------ */
/* Boot: ?shot= fixed scene, otherwise the live editor                 */
/* ------------------------------------------------------------------ */

buildPickers();
buildPanelList();

const shot = new URLSearchParams(location.search).get('shot');
if (shot) {
  runShot(shot, new URLSearchParams(location.search), async (scene) => {
    const [w, h] = scene.size.split('x').map(Number);
    canvas.width = w;
    canvas.height = h;
    state.layout = scene.layout;
    state.grade = scene.grade;
    state.title = scene.caption;
    state.subtitle = scene.subtitle;
    buildPanels(scene.layout);
    // Cover shots are the finished artwork: no selection outline on them.
    // (The editor shot keeps panel 0 selected to show the feature.)
    if (shot === 'cover') selectedIndex = -1;
    const img = await loadImage('./samples/' + scene.photo + '.jpg');
    state.panels.forEach((panel, i) => {
      panel.img = img;
      // Same photo everywhere, nudged a little per panel so the
      // multi-panel layouts look composed rather than cloned.
      panel.px = Math.min(0.65, Math.max(0.35, 0.5 + ((i % 3) - 1) * 0.06));
      panel.py = Math.min(0.65, Math.max(0.35, 0.5 + (Math.floor(i / 3) - 1) * 0.06));
      panel.scale = 1;
    });
    // Keep the (hidden in cover mode) controls in sync with the scene.
    titleInput.value = state.title;
    subtitleInput.value = state.subtitle;
    titleColor.value = state.titleColor;
    titlePos.value = state.titlePos;
    grainToggle.checked = state.grain;
    vignetteToggle.checked = state.vignette;
    buildPanelList();
    syncPickerActive();
    await redraw();
  });
} else {
  redraw();
}
