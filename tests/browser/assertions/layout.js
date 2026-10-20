const DEFAULT_TOLERANCE = 1;

function locatorText(locator) {
  return locator.toString();
}

async function describeLocator(locator, index = null) {
  const details = await locator.evaluate(element => ({
    id: element.id || null,
    testId: element.getAttribute('data-testid'),
    ariaLabel: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    role: element.getAttribute('role'),
    text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  }));
  return {
    selector: locatorText(locator),
    index,
    identifier: details.id || details.testId || null,
    accessibleName: details.ariaLabel || details.title || details.text || null,
    ...details
  };
}

function failure(name, diagnostics) {
  const error = new Error(`${name} failed\n${JSON.stringify(diagnostics, null, 2)}`);
  error.diagnostics = diagnostics;
  return error;
}

async function visibleBoxes(locator, { visibleOnly = true } = {}) {
  const count = await locator.count();
  const boxes = [];
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    let box = await item.boundingBox();
    if (!box) {
      box = await item.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
    }
    if (!box || box.width <= 0 || box.height <= 0) continue;
    if (visibleOnly) {
      const visible = await item.evaluate(element => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity) !== 0;
      });
      if (!visible) continue;
    }
    boxes.push({ locator: item, box, index });
  }
  return boxes;
}

export async function assertNoUnexpectedOverflow(page, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return {
      documentScrollWidth: root.scrollWidth,
      documentClientWidth: root.clientWidth,
      bodyScrollWidth: body?.scrollWidth ?? null,
      bodyClientWidth: body?.clientWidth ?? null,
      scrollX: window.scrollX,
      windowInnerWidth: window.innerWidth
    };
  });
  const viewportSize = page.viewportSize();
  const metricsWithViewport = {
    viewportWidth: viewportSize?.width ?? metrics.windowInnerWidth,
    viewportHeight: viewportSize?.height ?? await page.evaluate(() => window.innerHeight),
    ...metrics
  };
  const overflowing = metrics.documentScrollWidth > metricsWithViewport.viewportWidth + tolerance;
  const diagnostics = { passed: !overflowing, tolerance, ...metricsWithViewport };
  if (overflowing) throw failure('assertNoUnexpectedOverflow', diagnostics);
  return diagnostics;
}

export async function assertInsideViewport(page, locator, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const viewportSize = page.viewportSize();
  const viewport = {
    x: 0,
    y: 0,
    width: viewportSize?.width ?? await page.evaluate(() => window.innerWidth),
    height: viewportSize?.height ?? await page.evaluate(() => window.innerHeight),
    ...(await page.evaluate(() => ({ scrollX: window.scrollX, scrollY: window.scrollY })))
  };

  const entries = await visibleBoxes(locator, options);
  const failures = [];
  for (const { locator: item, box, index } of entries) {
    if (
      box.x < viewport.x - tolerance ||
      box.y < viewport.y - tolerance ||
      box.x + box.width > viewport.x + viewport.width + tolerance ||
      box.y + box.height > viewport.y + viewport.height + tolerance
    ) {
      failures.push({ ...(await describeLocator(item, index)), rectangle: box, viewport });
    }
  }
  const diagnostics = { passed: failures.length === 0, tolerance, viewport, failures };
  if (failures.length) throw failure('assertInsideViewport', diagnostics);
  return diagnostics;
}

export async function assertContained(page, child, container, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const containerBox = await container.boundingBox();
  const children = await visibleBoxes(child, options);
  const failures = [];
  if (!containerBox) {
    failures.push({ container: await describeLocator(container), reason: 'container has no visible rectangle' });
  }
  for (const { locator: item, box, index } of children) {
    if (!containerBox) {
      failures.push({ ...(await describeLocator(item, index)), rectangle: box });
      continue;
    }
    if (
      box.x < containerBox.x - tolerance ||
      box.y < containerBox.y - tolerance ||
      box.x + box.width > containerBox.x + containerBox.width + tolerance ||
      box.y + box.height > containerBox.y + containerBox.height + tolerance
    ) {
      failures.push({ ...(await describeLocator(item, index)), rectangle: box, container: containerBox });
    }
  }
  const diagnostics = { passed: failures.length === 0, tolerance, container: containerBox, failures };
  if (failures.length) throw failure('assertContained', diagnostics);
  return diagnostics;
}

function overlaps(a, b, tolerance) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right - left > tolerance && bottom - top > tolerance;
}

function contains(outer, inner, tolerance) {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance;
}

function allowlisted(allowOverlap, first, second) {
  if (!allowOverlap) return false;
  if (typeof allowOverlap === 'function') return allowOverlap(first, second);
  const values = Array.isArray(allowOverlap) ? allowOverlap : [allowOverlap];
  const identifiers = [
    first.identifier,
    second.identifier,
    `${first.identifier ?? first.selector}:${second.identifier ?? second.selector}`,
    `${second.identifier ?? second.selector}:${first.identifier ?? first.selector}`
  ];
  return values.some(entry => {
    if (typeof entry === 'string') return identifiers.includes(entry);
    if (Array.isArray(entry)) return entry.length === 2 &&
      ((entry[0] === first.identifier && entry[1] === second.identifier) ||
       (entry[1] === first.identifier && entry[0] === second.identifier));
    return false;
  });
}

export async function assertNoUnexpectedOverlap(page, locator, options = {}) {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const entries = await visibleBoxes(locator, options);
  const failures = [];
  for (let firstIndex = 0; firstIndex < entries.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex += 1) {
      const first = entries[firstIndex];
      const second = entries[secondIndex];
      if (!overlaps(first.box, second.box, tolerance)) continue;
      const firstDetails = { ...(await describeLocator(first.locator, first.index)), rectangle: first.box };
      const secondDetails = { ...(await describeLocator(second.locator, second.index)), rectangle: second.box };
      if (options.allowContainment !== false && (contains(first.box, second.box, tolerance) || contains(second.box, first.box, tolerance))) continue;
      if (allowlisted(options.allowOverlap, firstDetails, secondDetails)) continue;
      failures.push({ first: firstDetails, second: secondDetails });
    }
  }
  const diagnostics = { passed: failures.length === 0, tolerance, failures };
  if (failures.length) throw failure('assertNoUnexpectedOverlap', diagnostics);
  return diagnostics;
}
