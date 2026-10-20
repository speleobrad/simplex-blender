function failure(name, diagnostics) {
  const error = new Error(`${name} failed\n${JSON.stringify(diagnostics, null, 2)}`);
  error.diagnostics = diagnostics;
  return error;
}

async function describe(locator, index) {
  const details = await locator.evaluate(element => ({
    id: element.id || null,
    testId: element.getAttribute('data-testid'),
    ariaLabel: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    role: element.getAttribute('role'),
    text: (element.textContent || element.value || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  }));
  return {
    selector: locator.toString(),
    index,
    identifier: details.id || details.testId || null,
    accessibleName: details.ariaLabel || details.title || details.text || null,
    ...details
  };
}

export async function assertNoClippedText(page, locator, options = {}) {
  const tolerance = options.tolerance ?? 1;
  const count = await locator.count();
  const failures = [];
  for (let index = 0; index < count; index += 1) {
    const item = locator.nth(index);
    const rectangle = await item.boundingBox();
    if (!rectangle || rectangle.width <= 0 || rectangle.height <= 0) continue;
    const metrics = await item.evaluate(element => {
      const style = getComputedStyle(element);
      const isControl = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(element.tagName) || element.getAttribute('role') === 'button';
      const text = (element.textContent || element.value || '').replace(/\s+/g, ' ').trim();
      const textNodes = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.trim()) textNodes.push(node);
      }
      const textRectangles = textNodes.flatMap(textNode => {
        const range = document.createRange();
        range.selectNodeContents(textNode);
        return [...range.getClientRects()].map(rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
      });
      const contentLeft = element.clientLeft;
      const contentTop = element.clientTop;
      return {
        isControl,
        text,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        textRectangles,
        clipX: element.scrollWidth > element.clientWidth,
        clipY: element.scrollHeight > element.clientHeight,
        contentLeft,
        contentTop
      };
    });
    if (!metrics.isControl && !options.includeNonControls) continue;
    const hiddenX = ['hidden', 'clip', 'auto', 'scroll'].includes(metrics.overflowX);
    const hiddenY = ['hidden', 'clip', 'auto', 'scroll'].includes(metrics.overflowY);
    const textOutside = metrics.textRectangles.some(rect =>
      rect.x < rectangle.x + metrics.contentLeft - tolerance ||
      rect.x + rect.width > rectangle.x + rectangle.width - metrics.contentLeft + tolerance ||
      rect.y < rectangle.y + metrics.contentTop - tolerance ||
      rect.y + rect.height > rectangle.y + rectangle.height - metrics.contentTop + tolerance
    );
    if ((metrics.clipX && hiddenX) || (metrics.clipY && hiddenY) || textOutside) {
      failures.push({ ...(await describe(item, index)), rectangle, metrics });
    }
  }
  const diagnostics = { passed: failures.length === 0, tolerance, failures };
  if (failures.length) throw failure('assertNoClippedText', diagnostics);
  return diagnostics;
}

function matchesExpected(value, expected) {
  if (!expected) return false;
  if (typeof expected === 'function') return expected(value);
  const list = Array.isArray(expected) ? expected : [expected];
  return list.some(entry => {
    if (entry instanceof RegExp) return entry.test(String(value));
    if (typeof entry === 'string') return String(value).includes(entry);
    return false;
  });
}

export function assertRuntimeClean(runtime, options = {}) {
  const source = runtime ?? {};
  const errors = Array.isArray(source.errors) ? source.errors : [];
  const consoleMessages = Array.isArray(source.consoleMessages) ? source.consoleMessages : [];
  const failedRequests = Array.isArray(source.failedRequests) ? source.failedRequests : [];
  const unexpectedErrors = errors.filter(error => !matchesExpected(error?.message ?? error, options.allowErrors));
  const unexpectedConsoleMessages = consoleMessages.filter(message => !matchesExpected(message, options.allowConsoleMessages ?? options.allowConsole));
  const unexpectedFailedRequests = failedRequests.filter(request => {
    const value = `${request?.url ?? ''} ${request?.errorText ?? ''}`;
    return !matchesExpected(value, options.allowFailedRequests ?? options.allowRequests);
  });
  const diagnostics = {
    passed: unexpectedErrors.length === 0 && unexpectedConsoleMessages.length === 0 && unexpectedFailedRequests.length === 0,
    errors: unexpectedErrors.map(error => error?.message ?? String(error)),
    consoleMessages: unexpectedConsoleMessages,
    failedRequests: unexpectedFailedRequests
  };
  if (!diagnostics.passed) throw failure('assertRuntimeClean', diagnostics);
  return diagnostics;
}
