// Regression tests for the embedded LuCI form and its virtual connection type.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let source = fs.readFileSync(path.join(__dirname,
    '../addon/luci-app-podkop-subscriptions/files/www/luci-static/resources/view/podkop/subscriptions.js'), 'utf8');
// Expose internal operations to the harness without adding a production API.
source = source.replace('return baseclass.extend({ attach: attach });',
    'return { attach, stateFor, choose, save, importLegacy, update, restoreSelection };');
const urlA = 'https://first.example/sub', urlB = 'https://second.example/sub';
const nodeA = { id: 'a'.repeat(64), name: 'Same', host: 'one.example', port: 443 };
const nodeB = { id: 'b'.repeat(64), name: 'Same', host: 'two.example', port: 443 };
const nodeC = { id: 'd'.repeat(64), connection: 'e'.repeat(64), name: 'Other', host: 'three.example', port: 443 };
const sourceA = '1'.repeat(64), sourceB = '2'.repeat(64);
let writes = [], missing = '', links = {}, aliases = {}, extraServers = [];
const storage = new Map();
const browser = { sessionStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
} };
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
    if (method === 'refresh') return { ok: true, cached: true, source: url === urlA ? sourceA : sourceB,
        servers: url === urlA ? [nodeA, nodeC] : [nodeB] };
    if (method === 'resolve') {
        if (id === missing) return { ok: false, error: 'missing_server', message: 'Missing server' };
        id = aliases[id] || id;
        const server = [nodeA, nodeB, nodeC, ...extraServers].find(s => s.id === id);
        return { ok: true, id, connection: server.connection, name: server.name, link: links[id] || 'vless://user@' + server.host + ':443' };
    }
} };
function createApi() {
    return new Function('baseclass', 'form', 'rpc', 'uci', 'ui', 'window', source)(
        { extend: x => x }, { Value: 'Value' }, rpc, uci, {}, browser);
}
const api = createApi();
function fakeOption(option) {
    return { option, keylist: [], values: {}, value(key, label) { this.keylist.push(key); },
        depends() {}, cfgvalue(id, value) { if (arguments.length > 1) this.values[id] = value; return this.values[id]; },
        write(id, value) { uci.set('podkop', id, option, value); } };
}
const connection = fakeOption('connection_type');
connection.cfgvalue('main', 'subscription'); connection.cfgvalue('youtube', 'subscription');
const proxyType = fakeOption('proxy_config_type'), proxyLink = fakeOption('proxy_string');
const section = { children: [connection, proxyType, proxyLink],
    map: { chain(config) { this.chained = config; },
        async save() { if (this.failSave) throw new Error('invalid field'); await option.write('main'); },
        reset() { this.resetCalled = true; } },
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
    a.groups.set(urlA, { source: sourceA, servers: [nodeA, nodeC] }); b.groups.set(urlB, { source: sourceB, servers: [nodeB] });
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
    // Upgrade old full-URI IDs and use the latest provider parameters on save.
    const oldId = 'c'.repeat(64);
    aliases[oldId] = nodeA.id;
    config.podkop_subscriptions.bind_main.server = oldId;
    links[nodeA.id] = 'vless://user@one.example:443?security=reality&sid=new&spx=%2Fnew';
    const restored = createApi();
    const upgraded = restored.stateFor('main');
    upgraded.groups.set(urlA, { source: sourceA, servers: [nodeA, nodeC] });
    await restored.restoreSelection(upgraded);
    assert.equal(upgraded.selected.id, nodeA.id, 'old binding resolves to stable server ID');
    await restored.save('main');
    assert.equal(config.podkop.main.proxy_string, links[nodeA.id] + '#Same', 'saving takes latest Reality parameters');
    links = {};
    a.selected = { ...upgraded.selected };
    missing = nodeA.id;
    await option.write('main'); // Saving unchanged bindings works without RAM cache.
    missing = '';
    a.map = section.map;
    await api.choose(a, urlA, nodeC);
    const draft = JSON.parse(storage.get('podkop-subscriptions:draft:main'));
    assert.deepEqual(draft, { source: sourceA, id: nodeC.id, connection: nodeC.connection });
    assert.equal(JSON.stringify(draft).includes(urlA), false, 'draft contains no URL or proxy credentials');
    const reloaded = createApi();
    const reloadedState = reloaded.stateFor('main');
    reloadedState.groups.set(urlA, { source: sourceA, servers: [nodeA, nodeC] });
    await reloaded.restoreSelection(reloadedState);
    assert.equal(reloadedState.selected.id, nodeC.id, 'page reload restores pending choice');
    assert.equal(config.podkop_subscriptions.bind_main.server, nodeA.id, 'restoring draft cannot apply it');
    const renamedNode = { ...nodeC, id: 'f'.repeat(64), name: 'Renamed' };
    extraServers = [renamedNode];
    const renamedApi = createApi(), renamedState = renamedApi.stateFor('main');
    renamedState.groups.set(urlA, { source: sourceA, servers: [nodeA, renamedNode] });
    await renamedApi.restoreSelection(renamedState);
    assert.equal(renamedState.selected.id, renamedNode.id, 'draft survives a unique rename with the same connection');
    const ambiguousApi = createApi(), ambiguousState = ambiguousApi.stateFor('main');
    ambiguousState.groups.set(urlA, { source: sourceA, servers: [nodeA, renamedNode, { ...renamedNode, id: '0'.repeat(64) }] });
    await ambiguousApi.restoreSelection(ambiguousState);
    assert.equal(ambiguousState.selected.id, nodeA.id, 'ambiguous rename must not replace the saved choice');
    extraServers = [];
    section.map.failSave = true;
    await assert.rejects(section.map.save(), /invalid field/);
    assert.equal(storage.has('podkop-subscriptions:draft:main'), true, 'failed form save retains the draft');
    section.map.failSave = false;
    await section.map.save();
    assert.equal(storage.has('podkop-subscriptions:draft:main'), false, 'successful form save clears the draft');
    assert.equal(config.podkop_subscriptions.bind_main.server, nodeC.id);
    const persisted = createApi();
    assert.equal(persisted.stateFor('main').selected.id, nodeC.id, 'saved choice survives a new page instance');
    await api.choose(a, urlA, nodeA);
    section.map.reset();
    assert.equal(storage.has('podkop-subscriptions:draft:main'), false, 'Reset discards the draft');
    assert.equal(api.stateFor('main').selected.id, nodeC.id, 'Reset returns to the saved choice');
    connection.write('main', 'proxy');
    assert.equal(config.podkop_subscriptions.bind_main.enabled, '0', 'manual Proxy disables the virtual mode');
    assert.equal(connection.cfgvalue('main'), 'proxy');
    console.log('Embedded UI: stable ID migration, latest URI, draft/page reload, successful/failed save, Reset and manual-mode switch passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
