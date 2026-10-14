// Regression tests for the embedded LuCI form and its virtual connection type.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let source = fs.readFileSync(path.join(__dirname,
    '../addon/luci-app-podkop-subscriptions/files/www/luci-static/resources/view/podkop/subscriptions.js'), 'utf8');
// Expose internal operations to the harness without adding a production API.
source = source.replace('return baseclass.extend({ attach: attach });',
    'return { attach, stateFor, choose, save, importLegacy, update };');
const urlA = 'https://first.example/sub', urlB = 'https://second.example/sub';
const nodeA = { id: 'a'.repeat(64), name: 'Same', host: 'one.example', port: 443 };
const nodeB = { id: 'b'.repeat(64), name: 'Same', host: 'two.example', port: 443 };
let writes = [], missing = '';
const config = { podkop: {
    main: { '.type': 'section', connection_type: 'subscription', subscription_url: urlA, subscription_server: 'Same' },
    youtube: { '.type': 'section', connection_type: 'subscription', subscription_url: urlB, subscription_server: 'Same' }
}, podkop_subscriptions: { settings: { '.type': 'settings' } } };
const uci = {
    get: (c, s, k) => k ? config[c]?.[s]?.[k] : config[c]?.[s],
    set: (c, s, k, value) => { writes.push([c, s, k, value]); config[c][s][k] = value; },
    add: (c, type, s) => { config[c][s] = { '.type': type }; },
    sections: (c, type) => Object.entries(config[c] || {}).filter(([id, s]) => s['.type'] === type)
        .map(([id, s]) => ({ ...s, '.name': id }))
};
const rpc = { declare: ({ method }) => async (url, id) => {
    if (method === 'refresh') return { ok: true, cached: true, servers: [url === urlA ? nodeA : nodeB] };
    if (method === 'resolve') return id === missing ? { ok: false, message: 'Missing server' } :
        { ok: true, link: 'vless://user@' + (id === nodeA.id ? 'one' : 'two') + '.example:443' };
} };
const api = new Function('baseclass', 'form', 'rpc', 'uci', 'ui', source)(
    { extend: x => x }, { Value: 'Value' }, rpc, uci, {});
function fakeOption(option) {
    return { option, keylist: [], values: {}, value(key, label) { this.keylist.push(key); },
        depends() {}, cfgvalue(id, value) { if (arguments.length > 1) this.values[id] = value; return this.values[id]; },
        write(id, value) { uci.set('podkop', id, option, value); } };
}
const connection = fakeOption('connection_type');
connection.cfgvalue('main', 'subscription'); connection.cfgvalue('youtube', 'subscription');
const proxyType = fakeOption('proxy_config_type'), proxyLink = fakeOption('proxy_string');
const section = { children: [connection, proxyType, proxyLink],
    map: { chain(config) { this.chained = config; } },
    option(type, name) { const o = fakeOption(name); this.children.push(o); return o; } };
api.attach(section);
api.attach(section);
assert.equal(section.children.filter(o => o.option === '_podkop_subscription').length, 1, 'hook is idempotent');
assert.equal(section.children[1].option, '_podkop_subscription', 'panel immediately follows connection type');
assert.equal(section.map.chained, 'podkop_subscriptions', 'metadata participates in the parent Podkop form');
assert.equal(proxyType.retain, true); assert.equal(proxyLink.retain, true);
const option = section.children[1];

(async () => {
    const a = api.stateFor('main'), b = api.stateFor('youtube');
    a.groups.set(urlA, { servers: [nodeA] }); b.groups.set(urlB, { servers: [nodeB] });
    await api.importLegacy(a); await api.importLegacy(b);
    assert.equal(writes.length, 0, 'loading legacy selections cannot change routing');
    assert.equal(a.selected.id, nodeA.id); assert.equal(b.selected.id, nodeB.id);
    await api.update(a, urlA);
    assert.equal(writes.length, 0, 'refresh cannot stage routing changes');
    assert.equal(a.selected.id, nodeA.id, 'refresh retains chosen ID');
    missing = nodeA.id;
    await assert.rejects(option.write('main'), /Missing server/);
    assert.equal(writes.length, 0, 'failed resolution must not stage a partial selection');
    missing = '';
    await option.write('main'); await option.write('youtube');
    assert.equal(config.podkop.main.proxy_string, 'vless://user@one.example:443#Same');
    assert.equal(config.podkop.youtube.proxy_string, 'vless://user@two.example:443#Same');
    assert.equal(config.podkop.main.connection_type, 'proxy');
    assert.deepEqual(new Set(writes.filter(v => v[0] === 'podkop').map(v => v[2])),
        new Set(['connection_type', 'proxy_config_type', 'proxy_string']));
    connection.cfgvalue('main', 'proxy');
    assert.equal(connection.cfgvalue('main'), 'subscription', 'saved native proxy displays as subscription');
    assert.equal(option.forcewrite, true, 'URL list edits are saved even with an unchanged selection');
    missing = nodeA.id;
    await option.write('main'); // Saving unchanged bindings works without RAM cache.
    connection.write('main', 'proxy');
    assert.equal(config.podkop_subscriptions.bind_main.enabled, '0', 'manual Proxy disables the virtual mode');
    assert.equal(connection.cfgvalue('main'), 'proxy');
    console.log('Embedded UI: legacy import, stable IDs, no automatic switching, native proxy save, retention and manual-mode switch passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
