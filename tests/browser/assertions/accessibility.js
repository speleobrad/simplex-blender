function failure(name, diagnostics) {
  const error = new Error(`${name} failed\n${JSON.stringify(diagnostics, null, 2)}`);
  error.diagnostics = diagnostics;
  return error;
}

async function describe(locator) {
  const details = await locator.evaluate(element => ({
    id: element.id || null,
    testId: element.getAttribute('data-testid'),
    ariaLabel: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  }));
  return {
    selector: locator.toString(),
    identifier: details.id || details.testId || null,
    accessibleName: details.ariaLabel || details.title || details.text || null,
    ...details
  };
}

export async function assertVisibleFocus(page, locator, options = {}) {
  const tolerance = options.tolerance ?? 1;
  await locator.focus();
  const rectangle = await locator.boundingBox();
  const viewportSize = page.viewportSize();
  const viewport = {
    width: viewportSize?.width ?? await page.evaluate(() => window.innerWidth),
    height: viewportSize?.height ?? await page.evaluate(() => window.innerHeight),
    x: 0,
    y: 0,
    ...(await page.evaluate(() => ({ scrollX: window.scrollX, scrollY: window.scrollY })))
  };
  const details = await describe(locator);
  const active = await locator.evaluate(element => document.activeElement === element);
  const style = await locator.evaluate(element => {
    const computed = getComputedStyle(element);
    return {
      outlineStyle: computed.outlineStyle,
      outlineWidth: computed.outlineWidth,
      boxShadow: computed.boxShadow,
      visibility: computed.visibility,
      display: computed.display
    };
  });
  const intersection = rectangle && {
    left: Math.max(rectangle.x, viewport.x),
    top: Math.max(rectangle.y, viewport.y),
    right: Math.min(rectangle.x + rectangle.width, viewport.x + viewport.width),
    bottom: Math.min(rectangle.y + rectangle.height, viewport.y + viewport.height)
  };
  let coveredBy = null;
  if (rectangle && intersection && intersection.right > intersection.left && intersection.bottom > intersection.top) {
    coveredBy = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element ? {
        tagName: element.tagName,
        id: element.id || null,
        className: typeof element.className === 'string' ? element.className : null
      } : null;
    }, {
      x: (intersection.left + intersection.right) / 2,
      y: (intersection.top + intersection.bottom) / 2
    });
  }
  const covered = coveredBy && !await locator.evaluate((element, point) => {
    const target = document.elementFromPoint(point.x, point.y);
    return target === element || element.contains(target);
  }, coveredBy ? {
    x: (intersection.left + intersection.right) / 2,
    y: (intersection.top + intersection.bottom) / 2
  } : { x: -1, y: -1 });
  const focusRingVisible = style.outlineStyle !== 'none' || style.boxShadow !== 'none';
  const diagnostics = {
    passed: Boolean(active && rectangle && intersection && intersection.right - intersection.left > tolerance && intersection.bottom - intersection.top > tolerance && !covered && focusRingVisible),
    ...details,
    rectangle,
    viewport,
    intersection,
    active,
    coveredBy,
    focusRingVisible,
    style
  };
  if (!diagnostics.passed) throw failure('assertVisibleFocus', diagnostics);
  return diagnostics;
}

function panelList(selectors) {
  if (Array.isArray(selectors)) return selectors;
  if (typeof selectors === 'string') return [selectors];
  return selectors?.panels ?? selectors?.inactive ?? [];
}

export async function assertOnlyActivePanelsInteractive(page, selectors) {
  const panelSelectors = panelList(selectors);
  const diagnostics = await page.evaluate((values) => {
    const tabbableSelector = 'a[href], area[href], button, input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
    const panels = [];
    for (const selector of values) {
      const panel = document.querySelector(selector);
      if (!panel) {
        panels.push({ selector, missing: true, controls: [] });
        continue;
      }
      const panelStyle = getComputedStyle(panel);
      const hidden = panel.hidden || panel.getAttribute('aria-hidden') === 'true' || panel.classList.contains('hidden') || panelStyle.display === 'none' || panelStyle.visibility === 'hidden';
      const controls = [...panel.querySelectorAll(tabbableSelector)].filter(control => {
        const style = getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        return !control.disabled && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0 && control.tabIndex >= 0;
      }).map(control => ({
        id: control.id || null,
        ariaLabel: control.getAttribute('aria-label'),
        text: (control.textContent || control.value || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        tabIndex: control.tabIndex
      }));
      panels.push({ selector, hidden, controls });
    }
    return panels;
  }, panelSelectors);
  const missing = diagnostics.filter(panel => panel.missing);
  const hiddenInteractive = diagnostics.filter(panel => panel.hidden && panel.controls.length);
  const result = { passed: missing.length === 0 && hiddenInteractive.length === 0, panels: diagnostics, missing, hiddenInteractive };
  if (!result.passed) throw failure('assertOnlyActivePanelsInteractive', result);
  return result;
}
