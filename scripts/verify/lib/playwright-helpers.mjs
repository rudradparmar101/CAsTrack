// Small shared helpers for the Phase 7 Playwright scripts.

// Types into a focused, controlled field and verifies the DOM value landed —
// a server-action-triggered router refresh mid-type (e.g. right after
// submitting a previous form on the same page) can occasionally clip
// keystrokes typed via pressSequentially. Retries a couple of times.
async function typeAndVerify(locator, value, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    await locator.focus();
    await locator.fill('');
    await locator.pressSequentially(value, { delay: 5 });
    if ((await locator.inputValue()) === value) return;
  }
  throw new Error(`typeAndVerify: value never stuck after ${attempts} attempts (wanted "${value}")`);
}

export async function fillLabeled(page, label, value) {
  // Some inputs in this app are fully-controlled (value+onChange, no `name`
  // attribute — e.g. the login page and the client-form address/person rows)
  // and don't reliably pick up React's onChange from Playwright's .fill() in
  // this React 19 + Turbopack dev setup; pressSequentially (real keydown
  // events) is reliable everywhere. Using .focus() instead of .click() to
  // reach the field avoids Playwright's click-actionability scroll dance,
  // which fights this app's modal (a `max-h-[65vh] overflow-y-auto` region
  // inside a `fixed`-positioned dialog) and can leave a field stuck scrolled
  // out of view mid-test.
  const locator = page.getByLabel(label, { exact: true });
  await locator.scrollIntoViewIfNeeded();
  const type = await locator.getAttribute('type');
  if (type === 'date') {
    // Native date inputs parse a typed "2026-08-15" character stream through
    // per-segment keyboard entry (locale-ordered, no literal dashes) — .fill()
    // sets the ISO value directly and is the reliable way to drive these.
    await locator.fill(value);
    return;
  }
  await typeAndVerify(locator, value);
}

// Same controlled-input fill dance as fillLabeled, for fields with no
// <label> (e.g. the comment textarea, keyed only by placeholder).
export async function fillByPlaceholder(page, placeholder, value) {
  const locator = page.getByPlaceholder(placeholder, { exact: true });
  await locator.scrollIntoViewIfNeeded();
  await typeAndVerify(locator, value);
}

/** Select an <option> by its underlying `value` (e.g. enum keys like 'high'). */
export async function selectLabeled(page, label, value) {
  const select = page.getByLabel(label, { exact: true });
  await select.selectOption(value);
}

/** Select an <option> by its visible text (e.g. a client/department/member name). */
export async function selectByOptionText(page, label, optionText) {
  const select = page.getByLabel(label, { exact: true });
  await select.selectOption({ label: optionText });
}

export async function signupCreateFirm(page, { name, email, password, firmName }) {
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  // "Create Firm" is the default mode already.
  await fillLabeled(page, 'Full Name', name);
  await fillLabeled(page, 'Email', email);
  await fillLabeled(page, 'Password', password);
  await fillLabeled(page, 'Firm Name', firmName);
  await page.getByRole('button', { name: 'Create Account & Firm' }).click();
  await page.getByText('Check your email').waitFor({ timeout: 10000 });
}

export async function signupJoinFirm(page, { name, email, password, inviteCode }) {
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Join a Firm' }).click();
  await fillLabeled(page, 'Full Name', name);
  await fillLabeled(page, 'Email', email);
  await fillLabeled(page, 'Password', password);
  await fillLabeled(page, 'Invite Code', inviteCode);
  await page.getByRole('button', { name: 'Join & Create Account' }).click();
  await page.getByText('Check your email').waitFor({ timeout: 10000 });
}

export async function login(page, email, password) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await fillLabeled(page, 'Email', email);
  await fillLabeled(page, 'Password', password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|portal|onboarding)/, { timeout: 30000 });
  if (page.url().includes('/onboarding')) {
    // KNOWN BUG (documented in docs/verification/phase-7-runtime.md): when an
    // authenticated-but-unprovisioned user reaches /onboarding via a
    // client-side soft navigation (router.push from /login), the server
    // correctly encodes a NEXT_REDIRECT;/dashboard in the RSC response after
    // provisioning succeeds, but the Next.js 16 client router doesn't act on
    // it — the page just sits on /onboarding. A full reload (exactly what the
    // app's own "Retry Setup" link does on the sibling error path) always
    // resolves it, since a fresh GET gets a real HTTP 307. This never fires
    // for the app's real user-facing paths (email-confirm link and "Retry
    // Setup" are both full navigations already) — it's specific to this
    // test harness reaching /onboarding via a scripted client-side login.
    try {
      await page.waitForURL(/\/(dashboard|portal)/, { timeout: 4000 });
      return;
    } catch {
      await page.reload({ waitUntil: 'load' });
      await page.waitForURL(/\/(dashboard|portal)/, { timeout: 15000 });
    }
  }
}

// Creates an isolated browser context (own cookies/session) for one actor,
// logs in, and optionally persists the session to disk so later scripts
// (separate `node` processes) can restore it without logging in again.
// Tall viewport: this app's modals (e.g. the client form) are a scrollable
// column inside a fixed-height dialog under a sticky page header, and a
// default 720px-tall viewport causes real click-interception failures.
const VIEWPORT = { width: 1440, height: 1100 };

// This app's Modal animates in with a CSS transform (`animate-scale-in`).
// A transformed ancestor becomes the containing block for its `fixed`-
// positioned descendants per the CSS spec, which — combined with Playwright's
// auto-scroll-into-view landing mid-animation — made the modal's position
// genuinely unstable during scripted form-filling (oscillating between
// "outside viewport" and "sticky header intercepts pointer events"). Killing
// animation/transition duration for every page in the context fixes it.
async function disableAnimations(context) {
  await context.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }`;
    (document.head || document.documentElement).appendChild(style);
  });
}

export async function newActorSession(browser, { baseURL, email, password, statePath }) {
  const context = await browser.newContext({ baseURL, viewport: VIEWPORT });
  await disableAnimations(context);
  const page = await context.newPage();
  await login(page, email, password);
  if (statePath) {
    await context.storageState({ path: statePath });
  }
  return { context, page };
}

export async function restoreActorSession(browser, { baseURL, statePath }) {
  const context = await browser.newContext({ baseURL, storageState: statePath, viewport: VIEWPORT });
  await disableAnimations(context);
  const page = await context.newPage();
  return { context, page };
}

// Creates a client via the real staff UI (Clients list "Add Client" modal),
// including one address row and one authorized-person row.
export async function createClient(page, { name, businessType, gstin, address, person }) {
  await page.goto('/clients', { waitUntil: 'domcontentloaded' });
  // On an empty client list the empty-state CTA is ALSO labeled "Add Client",
  // in addition to the toolbar trigger — .first() picks the toolbar one.
  await page.getByRole('button', { name: 'Add Client' }).first().click();
  await page.getByRole('heading', { name: 'Add New Client' }).waitFor({ timeout: 10000 });

  await fillLabeled(page, 'Legal Name', name);
  if (businessType) await selectLabeled(page, 'Business Type', businessType);
  if (gstin) await fillLabeled(page, 'GSTIN', gstin);

  if (address) {
    await page.getByRole('button', { name: 'Add address' }).click();
    await fillLabeled(page, 'Line 1', address.line1);
    await fillLabeled(page, 'City', address.city);
    await fillLabeled(page, 'State', address.state);
    if (address.stateCode) await fillLabeled(page, 'State Code', address.stateCode);
    if (address.pincode) await fillLabeled(page, 'PIN Code', address.pincode);
  }

  if (person) {
    await page.getByRole('button', { name: 'Add person' }).click();
    await fillLabeled(page, 'Name', person.name);
    if (person.designation) await fillLabeled(page, 'Designation', person.designation);
  }

  // Scope to the modal's <form> — the page header behind the modal also has
  // an "Add Client" button (the trigger), so an unscoped role query is ambiguous.
  await page.locator('form').getByRole('button', { name: 'Add Client', exact: true }).click();
  await page.getByRole('heading', { name: 'Add New Client' }).waitFor({ state: 'detached', timeout: 10000 });
  await page.getByText(name, { exact: true }).first().waitFor({ timeout: 10000 });
}

// Creates a task via the real "New Task" modal on /tasks.
export async function createTask(page, task) {
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New Task' }).first().click();
  await page.getByRole('heading', { name: 'Create New Task' }).waitFor({ timeout: 10000 });

  await fillLabeled(page, 'Task Title', task.title);
  if (task.description) await fillLabeled(page, 'Description', task.description);
  await selectByOptionText(page, 'Client', task.client);
  await selectByOptionText(page, 'Department', task.department);
  await fillLabeled(page, 'Due Date', task.dueDate);
  if (task.periodLabel) await fillLabeled(page, 'Period', task.periodLabel);
  if (task.priority) await selectLabeled(page, 'Priority', task.priority);
  if (task.recurrence) await selectLabeled(page, 'Recurrence', task.recurrence);
  if (task.assignTo) await selectByOptionText(page, 'Assign To', task.assignTo);
  if (task.reviewer) await selectByOptionText(page, 'Reviewer', task.reviewer);
  if (task.visibleToClient === false) {
    await page.getByLabel('Visible in the client portal', { exact: true }).uncheck();
  }

  await page.locator('form').getByRole('button', { name: 'Create Task', exact: true }).click();
  await page.getByRole('heading', { name: 'Create New Task' }).waitFor({ state: 'detached', timeout: 10000 });
}

export function log(label, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${label}${detail ? ' — ' + detail : ''}`);
  return { label, ok, detail };
}
