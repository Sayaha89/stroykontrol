// Tests run the actual page script with an in-memory DOM and Supabase double.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
class Element {
  constructor(id, hidden = false) {
    this.id = id; this.value = ''; this.textContent = ''; this.children = []; this.disabled = false;
    this.options = ['Не начат','В работе','Приостановлен','Завершён'].map(value => ({value}));
    this.classes = new Set(hidden ? ['hidden'] : []);
    this.classList = {add: v => this.classes.add(v), remove: v => this.classes.delete(v), contains: v => this.classes.has(v)};
  }
  replaceChildren() { this.children = []; this.textContent = ''; }
  append(...items) { this.children.push(...items); }
  addEventListener() {}
  scrollIntoView() {}
  focus() {}
  checkValidity() { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value); }
  click() { return this.disabled ? undefined : this.onclick?.(); }
}
async function scenario(mode) {
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id, ['app', 'retry', 'recovery'].includes(id))]));
  for (const id of ['signIn', 'forgot', 'savePassword']) elements[id].disabled = true;
  elements.status.value = 'В работе';
  const user = {id: 'test-user', email: 'test@example.com'};
  let session = mode.startsWith('recovery') && mode !== 'recovery-expired' ? {user} : null;
  let rows = [], callback, resetRequest, savedPassword;
  const mock = {
    auth: {
      getSession: async () => ({data: {session}, error: null}),
      getUser: async () => ({data: {user: session?.user || null}, error: null}),
      onAuthStateChange: cb => { callback = cb; },
      signInWithPassword: async () => { session = {user}; return {error: null}; },
      signOut: async () => { session = null; callback('SIGNED_OUT'); return {error: null}; },
      resetPasswordForEmail: async (email, opts) => { resetRequest = {email, opts}; return {error: mode === 'email-error' ? {status: 429} : null}; },
      updateUser: async ({password}) => { savedPassword = password; return {error: mode === 'recovery-save-error' ? {message: 'Save failed'} : null}; }
    },
    from() {
      let operation = 'select', value, id;
      const query = {
        select() { return query; }, order() { return query; }, eq(k, v) { id = v; return query; },
        maybeSingle: async () => ({data: mode === 'denied' ? null : {user_id: user.id}, error: mode === 'access-error' ? {code: '42501'} : null}),
        insert(v) { operation = 'insert'; value = v; return query; },
        update(v) { operation = 'update'; value = v; return query; },
        delete() { operation = 'delete'; return query; },
        then(resolve, reject) {
          if (operation === 'insert' && mode === 'save-error') return Promise.resolve({data: null, error: {code: '42501'}}).then(resolve, reject);
          if (operation === 'update' && mode === 'update-error') return Promise.resolve({data: null, error: {code: '42501'}}).then(resolve, reject);
          let data = rows;
          if (operation === 'update') { data = mode === 'update-denied' ? [] : rows.filter(row => row.id === id).map(row => {Object.assign(row, value); return {id: row.id};}); }
          if (operation === 'insert') { rows.push({id: 1, ...value}); data = [{id: 1}]; }
          if (operation === 'delete') { data = mode === 'delete-denied' ? [] : rows.filter(row => row.id === id); if (data.length) rows = rows.filter(row => row.id !== id); }
          return Promise.resolve({data, error: null}).then(resolve, reject);
        }
      };
      return query;
    }
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const script = new AsyncFunction('document', 'loadClient', 'confirm', 'location', 'history', 'setTimeout', 'clearTimeout', 'URLSearchParams', 'URL', 'AbortController', 'fetch', source.replace(/import\('https:\/\/cdn.jsdelivr.net[^']+'\)/, 'loadClient()'));
  await script({getElementById: id => elements[id], createElement: () => new Element()}, async () => {
    if (mode === 'cdn-error') throw Error('CDN failed'); return {createClient: () => mock};
  }, () => true, {origin: 'https://app.test', pathname: '/stroykontrol/', search: mode.startsWith('recovery') ? '?recovery=1' : '', hash: '', reload() {}}, {replaceState() {}}, setTimeout, clearTimeout, URLSearchParams, URL, AbortController, fetch);
  const el = elements;
  if (mode === 'cdn-error') { assert(el.signIn.disabled); assert(!el.retry.classList.contains('hidden')); return; }
  if (mode.startsWith('recovery')) {
    assert(!el.recovery.classList.contains('hidden')); assert(el.app.classList.contains('hidden'));
    if (mode === 'recovery-expired') { assert(el.savePassword.disabled); assert(el.recoveryMsg.textContent.includes('истекла')); return; }
    el.newPassword.value = 'short'; await el.savePassword.click(); assert.equal(savedPassword, undefined);
    el.newPassword.value = 'new-test-password'; el.repeatPassword.value = 'different'; await el.savePassword.click(); assert.equal(savedPassword, undefined);
    el.repeatPassword.value = el.newPassword.value; await el.savePassword.click(); assert.equal(savedPassword, 'new-test-password');
    if (mode === 'recovery-save-error') { assert(el.recoveryMsg.textContent.includes('Save failed')); assert(!el.savePassword.disabled); }
    else { assert(el.recovery.classList.contains('hidden')); assert(!el.app.classList.contains('hidden')); assert.equal(el.newPassword.value, ''); }
    return;
  }
  el.email.value = 'test@example.com';
  if (['email', 'email-error'].includes(mode)) {
    await el.forgot.click(); assert.equal(resetRequest.email, 'test@example.com'); assert.equal(resetRequest.opts.redirectTo, 'https://app.test/stroykontrol/?recovery=1');
    assert(el.loginMsg.textContent.includes(mode === 'email' ? 'Если эта почта' : 'Слишком много')); assert(!el.forgot.disabled); return;
  }
  el.password.value = 'test-password'; await el.signIn.click();
  if (['access-error', 'denied'].includes(mode)) { assert(el.app.classList.contains('hidden')); assert(el.loginMsg.textContent.includes('доступ')); return; }
  assert(!el.app.classList.contains('hidden'));
  el.name.value = '<script>alert(1)</script>'; el.responsible.value = 'Иванов Иван'; await el.add.click();
  if (mode === 'save-error') { assert(el.addMsg.textContent.includes('Ошибка')); assert.equal(el.name.value, '<script>alert(1)</script>'); assert(!el.add.disabled); return; }
  assert.equal(el.objects.children[0].children[0].textContent, '<script>alert(1)</script>');
  const button = text => el.objects.children[0].children.find(child => child.textContent === text);
  assert.equal(rows[0].responsible, 'Иванов Иван');
  assert.equal(el.objects.children[0].children[3].textContent, 'Ответственный: Иванов Иван');
  if (mode.startsWith('update') || mode === 'edit-cancel') {
    button('Редактировать').click();
    assert.equal(el.responsible.value, 'Иванов Иван');
    assert.equal(el.formTitle.textContent, 'Редактировать объект');
    el.name.value = 'Новое название'; el.responsible.value = 'Петров Пётр'; el.status.value = 'В работе';
    if (mode === 'edit-cancel') { await el.cancelEdit.click(); assert.equal(rows[0].name, '<script>alert(1)</script>'); assert.equal(el.name.value, ''); return; }
    await el.add.click();
    if (['update-error','update-denied'].includes(mode)) { assert.equal(el.name.value, 'Новое название'); assert(el.addMsg.textContent.includes('Ошибка')); assert.equal(rows[0].responsible, 'Иванов Иван'); assert(!el.add.disabled); return; }
    assert.equal(rows.length, 1); assert.equal(rows[0].name, 'Новое название'); assert.equal(rows[0].responsible, 'Петров Пётр'); assert.equal(rows[0].status, 'В работе');
    await el.reload.click(); assert.equal(el.objects.children[0].children[3].textContent, 'Ответственный: Петров Пётр');
    button('Редактировать').click(); el.responsible.value = ''; await el.add.click(); assert.equal(rows[0].responsible, null);
    assert.equal(el.formTitle.textContent, 'Добавить объект'); assert(el.cancelEdit.classList.contains('hidden'));
  }
  await button('Удалить объект').click();
  if (mode === 'delete-denied') { assert.equal(rows.length, 1); assert(el.listMsg.textContent.includes('не удалён')); }
  else { assert.equal(rows.length, 0); assert.equal(el.objects.textContent, 'Объекты пока не добавлены'); }
  await el.signOut.click(); assert(el.app.classList.contains('hidden')); assert.equal(el.objects.children.length, 0);
}
(async () => {
  for (const mode of ['normal', 'access-error', 'denied', 'cdn-error', 'save-error', 'delete-denied', 'email', 'email-error', 'recovery', 'recovery-expired', 'recovery-save-error', 'update', 'update-error', 'update-denied', 'edit-cancel']) {
    await scenario(mode); console.log(`${mode}: passed`);
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
