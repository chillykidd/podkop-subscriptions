'use strict';
'require baseclass';
'require form';
'require rpc';
'require uci';
'require ui';

const cache = rpc.declare({ object: 'podkop-subscriptions', method: 'cache', params: ['url'], expect: {} });
const refresh = rpc.declare({ object: 'podkop-subscriptions', method: 'refresh', params: ['url'], expect: {} });
const resolve = rpc.declare({ object: 'podkop-subscriptions', method: 'resolve', params: ['url', 'server'], expect: {} });
const probe = rpc.declare({ object: 'podkop-subscriptions', method: 'probe', params: ['url', 'server'], expect: {} });
const states = Object.create(null);
let queue = Promise.resolve();

function request(fn) { const result = queue.catch(() => {}).then(fn); queue = result; return result; }
function check(data) { if (!data || !data.ok) throw new Error(data && data.message || 'Не удалось выполнить запрос'); return data; }
function list(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function urls(value) { return Array.from(new Set(list(value).map(s => String(s).trim()).filter(Boolean))); }
function binding(id) { return uci.get('podkop_subscriptions', 'bind_' + id) || {}; }
function token(selected) { return selected ? selected.url + '\n' + selected.id : ''; }
function same(a, b) { return a && b && a.url === b.url && a.id === b.id; }

function stateFor(id) {
    if (states[id]) return states[id];
    const saved = binding(id);
    const legacy = urls(uci.get('podkop', id, 'subscription_urls')).concat(urls(uci.get('podkop', id, 'subscription_url')));
    let sourceUrls = urls(saved.urls || legacy);
    if (!sourceUrls.length) sourceUrls = urls(uci.get('podkop_subscriptions', 'settings', 'urls'));
    if (!sourceUrls.length) sourceUrls = urls(uci.sections('podkop', 'section').flatMap(s =>
        list(s.subscription_urls).concat(list(s.subscription_url))));
    const selected = saved.enabled === '1' && saved.server && saved.link === uci.get('podkop', id, 'proxy_string')
        ? { url: saved.url, id: saved.server, name: saved.name, link: saved.link.split('#')[0] } : null;
    return states[id] = { id: id, urls: sourceUrls.length ? sourceUrls : [''], groups: new Map(),
        selected: selected, legacy: uci.get('podkop', id, 'connection_type') === 'subscription'
            ? uci.get('podkop', id, 'subscription_server') : '', busy: false, started: false, status: '' };
}

function paintAll() { Object.values(states).forEach(paint); }
async function action(state, fn) {
    if (state.busy) return;
    state.busy = true; paintAll();
    try { await fn(); }
    catch (e) { state.status = e.message; ui.addNotification(null, E('p', {}, e.message), 'error'); }
    finally { state.busy = false; paintAll(); }
}

function button(state, text, fn, disabled) {
    return E('button', { type: 'button', class: 'btn cbi-button cbi-button-action',
        disabled: state.busy || state.readonly || disabled || null, click: () => action(state, fn) }, text);
}

async function choose(state, url, server) {
    const reply = check(await request(() => resolve(url, server.id)));
    state.selected = { url: url, id: server.id, name: server.name, link: reply.link };
    state.legacy = '';
    state.status = 'Выбран: ' + server.name + '. Нажмите «Сохранить и применить».';
    paintAll();
}

async function importLegacy(state) {
    if (!state.legacy || state.selected) return;
    const matches = state.urls.flatMap(url => ((state.groups.get(url) || {}).servers || [])
        .filter(s => s.name === state.legacy).map(s => ({ url: url, server: s })));
    // Name-based migration is allowed only when all sources are loaded and the
    // match is unique. Never choose the first server after an update.
    if (state.urls.filter(Boolean).some(url => !state.groups.has(url))) return;
    if (matches.length !== 1) {
        state.status = 'Старый выбор: ' + state.legacy + '. Выберите сервер вручную: совпадение не единственное или узел отсутствует.';
        return;
    }
    const reply = check(await request(() => resolve(matches[0].url, matches[0].server.id)));
    state.selected = { url: matches[0].url, id: matches[0].server.id, name: state.legacy, link: reply.link };
    state.status = 'Текущий сервер сохранён. Настройки изменятся только при сохранении формы.';
}

async function load(state) {
    for (const url of state.urls.filter(Boolean)) {
        try {
            let data = check(await request(() => cache(url)));
            if (!data.cached) data = check(await request(() => refresh(url)));
            state.groups.set(url, data);
        } catch (e) { state.status = e.message; }
        paintAll();
    }
    await importLegacy(state);
    paintAll();
}

async function update(state, url) {
    const data = check(await request(() => refresh(url)));
    state.groups.set(url, data);
    state.status = 'Список обновлён' + (data.skipped ? '; пропущено строк: ' + data.skipped : '');
    await importLegacy(state);
}

async function ping(state, url, server) {
    try { server.ms = check(await request(() => probe(url, server.id))).ms; server.error = ''; }
    catch (e) { server.ms = null; server.error = e.message; }
    state.status = server.name + ': ' + (server.error || server.ms + ' мс (ICMP)');
    paintAll();
}

function paint(state) {
    if (!state.panel) return;
    const content = [E('style', {},
        '.pks-inline{max-width:680px}.pks-card{padding:10px;border:1px solid #7775;border-radius:12px;margin:8px 0}' +
        '.pks-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.pks-url{flex:1;min-width:180px}' +
        '.pks-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #7775;border-radius:10px;margin-top:6px}' +
        '.pks-row.is-selected{border-color:#4c8dff;box-shadow:inset 0 0 0 1px #4c8dff}.pks-name{flex:1;overflow-wrap:anywhere}' +
        '.pks-row button{flex:none}.pks-pick{background:transparent!important;color:#4c8dff!important;border:0!important;box-shadow:none!important;padding:0!important;min-width:18px}' +
        '.pks-badge{font-size:11px;padding:2px 7px;border-radius:999px;background:#4c8dff;color:#fff}' +
        '.pks-status{font-size:12px;opacity:.8}.pks-ms{min-width:60px;text-align:right;color:#3dbe7a}'),
        E('div', { class: 'pks-status', role: 'status' }, state.busy ? 'Выполняется проверка…' : state.status || 'Подписки')];
    state.urls.forEach((url, index) => {
        const group = state.groups.get(url);
        const input = E('input', { class: 'cbi-input-text pks-url', type: 'password', autocomplete: 'off',
            value: url, placeholder: 'https://example.com/sub/…', 'aria-label': 'Подписка ' + state.id + ' ' + (index + 1),
            disabled: state.busy || state.readonly || null, change: ev => action(state, async () => {
                const next = ev.target.value.trim();
                if (next && !/^https:\/\/[^\s]+$/.test(next)) throw new Error('Введите HTTPS-ссылку подписки');
                state.urls[index] = next;
                if (next) await update(state, next);
            }) });
        const rows = ((group || {}).servers || []).map(server => {
            const selected = state.selected && state.selected.url === url && state.selected.id === server.id;
            const used = Object.values(states).filter(s => s.selected && s.selected.url === url && s.selected.id === server.id);
            const picker = button(state, selected ? '●' : '○', () => choose(state, url, server), false);
            picker.classList.add('pks-pick');
            picker.setAttribute('aria-label', 'Выбрать ' + server.name + ' для ' + state.id);
            picker.setAttribute('aria-pressed', selected ? 'true' : 'false');
            return E('div', { class: 'pks-row' + (selected ? ' is-selected' : ''),
                click: ev => { if (!state.readonly && !ev.target.closest('button')) action(state, () => choose(state, url, server)); } }, [
                picker,
                E('span', { class: 'pks-name' }, server.name),
                ...used.map(s => E('span', { class: 'pks-badge' }, s.id)),
                E('span', { class: 'pks-ms', title: server.error || 'ICMP' }, server.ms == null ? '—' : Math.round(server.ms) + ' мс'),
                button(state, 'Пинг', () => ping(state, url, server))
            ]);
        });
        content.push(E('div', { class: 'pks-card' }, [E('div', { class: 'pks-line' }, [input,
            E('button', { type: 'button', class: 'btn', click: () => { input.type = input.type === 'password' ? 'text' : 'password'; } }, 'Показать'),
            button(state, 'Обновить', () => update(state, url), !url),
            button(state, 'Удалить', async () => { state.urls.splice(index, 1); if (!state.urls.length) state.urls.push(''); })]),
            ...rows]));
    });
    if (state.selected && !state.urls.some(url => url === state.selected.url))
        content.push(E('p', { class: 'pks-status' }, 'Источник выбранного сервера удалён из списка. Сохранённая ссылка продолжит работать.'));
    if (state.selected && state.groups.has(state.selected.url) &&
        !state.groups.get(state.selected.url).servers.some(s => s.id === state.selected.id))
        content.push(E('p', { class: 'pks-status' }, 'Выбранный сервер отсутствует в подписке. Текущий выбор сохранён; замените его вручную.'));
    content.push(E('div', { class: 'pks-line' }, [
        button(state, 'Добавить подписку', async () => {
            if (state.urls.length >= 16) throw new Error('Максимум 16 подписок');
            state.urls.push('');
        }),
        button(state, 'Пинговать все', async () => {
            const jobs = state.urls.flatMap(url => ((state.groups.get(url) || {}).servers || []).map(server => ({ url, server })));
            if (jobs.length > 32) throw new Error('Проверка всех ограничена 32 серверами');
            for (const job of jobs) await ping(state, job.url, job.server);
        })]));
    content.push(E('div', { class: 'pks-status' }, 'Задержка ICMP до узла; работоспособность прокси не проверяется.'));
    state.panel.replaceChildren(...content);
}

async function save(id) {
    const state = stateFor(id), selected = state.selected;
    if (state.busy || !selected || !selected.link) throw new Error('Дождитесь загрузки подписки и выберите сервер для ' + id);
    const saved = binding(id);
    // Keeping an unchanged binding does not require the subscription cache or
    // provider to be available; Podkop already stores the complete proxy URI.
    const unchanged = saved.enabled === '1' && saved.link && saved.link.split('#')[0] === selected.link &&
        uci.get('podkop', id, 'connection_type') === 'proxy' && uci.get('podkop', id, 'proxy_string') === saved.link;
    if (!unchanged) {
        const data = check(await request(() => resolve(selected.url, selected.id)));
        if (data.link !== selected.link) throw new Error('Ссылка изменилась. Выберите сервер повторно.');
    }
    const sid = 'bind_' + id;
    const nativeLink = selected.link + '#' + encodeURIComponent(selected.name || '');
    if (!uci.get('podkop_subscriptions', sid)) uci.add('podkop_subscriptions', 'binding', sid);
    for (const [key, value] of Object.entries({ target: id, enabled: '1', url: selected.url, server: selected.id,
        name: selected.name, link: nativeLink, urls: urls(state.urls) })) uci.set('podkop_subscriptions', sid, key, value);
    uci.set('podkop', id, 'connection_type', 'proxy');
    uci.set('podkop', id, 'proxy_config_type', 'url');
    uci.set('podkop', id, 'proxy_string', nativeLink);
}

function attach(section) {
    const connection = section.children.find(o => o.option === 'connection_type');
    if (!connection || section.children.some(o => o.option === '_podkop_subscription')) return;
    section.map.chain('podkop_subscriptions');
    ['proxy_string', 'proxy_config_type'].forEach(name => {
        const nativeOption = section.children.find(o => o.option === name);
        if (nativeOption) nativeOption.retain = true;
    });
    connection.value('subscription', 'Подписка');
    const originalCfg = connection.cfgvalue, originalWrite = connection.write;
    connection.cfgvalue = function(id, value) {
        if (arguments.length > 1) return originalCfg.apply(this, arguments);
        const raw = originalCfg.call(this, id), saved = binding(id);
        return raw === 'proxy' && saved.enabled === '1' && saved.link === uci.get('podkop', id, 'proxy_string')
            && uci.get('podkop', id, 'proxy_config_type') === 'url' ? 'subscription' : raw;
    };
    connection.write = function(id, value) {
        if (value === 'subscription') return; // The panel writes native proxy fields after validation.
        if (uci.get('podkop_subscriptions', 'bind_' + id)) uci.set('podkop_subscriptions', 'bind_' + id, 'enabled', '0');
        return originalWrite.call(this, id, value);
    };
    // Preserve proxy-specific routing controls while the virtual subscription
    // type is visible. Detailed manual proxy configuration stays hidden.
    ['enable_udp_over_tcp', 'domain_resolver_enabled', 'resolve_real_ip_for_routing'].forEach(name => {
        const option = section.children.find(o => o.option === name);
        if (option) option.depends('connection_type', 'subscription');
    });
    const option = section.option(form.Value, '_podkop_subscription', 'Подписки');
    option.depends('connection_type', 'subscription');
    option.rmempty = false;
    option.retain = true;
    option.forcewrite = true;
    option.cfgvalue = function(id) { const b = binding(id); return b.server ? b.url + '\n' + b.server : ''; };
    option.formvalue = function(id) { return token(stateFor(id).selected); };
    option.isValid = function(id) { const s = stateFor(id); return !s.busy && !!(s.selected && s.selected.link); };
    option.getValidationError = function(id) { return 'Дождитесь загрузки и выберите сервер для ' + id; };
    option.write = function(id) { return save(id); };
    option.remove = function() {};
    option.renderWidget = function(id) {
        const state = stateFor(id);
        state.readonly = this.readonly != null ? this.readonly : this.map.readonly;
        state.panel = E('div', { class: 'pks-inline', 'data-pks-section': id });
        paint(state);
        if (!state.started) {
            state.started = true;
            action(state, () => load(state));
        }
        return state.panel;
    };
    // Put the panel directly under Connection Type, as in the original UI.
    section.children.splice(section.children.indexOf(option), 1);
    section.children.splice(section.children.indexOf(connection) + 1, 0, option);
}

return baseclass.extend({ attach: attach });
