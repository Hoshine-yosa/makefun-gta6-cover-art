/**
 * Neon Coast Cover Studio — fixed screenshot scenes (shots.js)
 *
 * runShot(shot, query, load) prepares one deterministic scene for a
 * screenshot: it reads the scene parameters out of the URL query,
 * puts the page into the matching shot mode (body class), then hands
 * the scene to the load callback in main.js, which loads the sample
 * photo, sets the state and redraws. Once the scene has rendered,
 * two animation frames later window.__shotReady is set so the
 * screenshot script knows the page is settled.
 *
 * query params (all optional):
 *   layout   hero | duo | trio | grid4 | grid9 | tilt   (default grid4)
 *   grade    sunset | neon | vice | mono | teal          (default sunset)
 *   photo    boulevard | pier                           (default pier)
 *   caption  title text                                 (default Neon Coast)
 *   subtitle subtitle text                              (default Vice City nights)
 *   size     1080x1080 | 1080x1350 | 1920x1080           (default 1080x1080)
 *
 * load receives { layout, grade, photo, caption, subtitle, size }.
 */

export async function runShot(shot, query, load) {
  const get = (key, fallback) => {
    const value = query.get(key);
    return value === null || value === '' ? fallback : value;
  };

  const scene = {
    layout: get('layout', 'grid4'),
    grade: get('grade', 'sunset'),
    photo: get('photo', 'pier'),
    caption: get('caption', 'Neon Coast'),
    subtitle: get('subtitle', 'Vice City nights'),
    size: get('size', '1080x1080'),
  };

  if (shot === 'cover') {
    document.body.classList.add('shot-cover');
  } else if (shot === 'editor') {
    document.body.classList.add('shot-editor');
  }

  await load(scene);

  await new Promise((resolve) => requestAnimationFrame(() => {
    requestAnimationFrame(resolve);
  }));
  window.__shotReady = true;
}
