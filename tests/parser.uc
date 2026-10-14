import { parse } from '../addon/podkop-subscriptions/files/usr/share/podkop-subscriptions/parser.uc';

let passed = 0;
function assert(value, description) {
    if (!value) die('FAIL: ' + description);
    passed++;
}
function rejects(raw, description) {
    let failed = false;
    try { parse(raw); } catch (e) { failed = true; }
    assert(failed, description);
}
let a = 'vless://test-user@one.example:443?security=tls';
let b = 'trojan://test-password@two.example:8443';
let data = parse(a + '#%D0%93%D0%B5%D1%80%D0%BC%D0%B0%D0%BD%D0%B8%D1%8F+A\r\n' + b + '#Same\n');
assert(length(data.servers) == 2, 'plain CRLF list');
assert(data.servers[0].name == 'Германия+A', 'UTF-8 percent decoding and literal plus');
assert(data.servers[0].host == 'one.example' && data.servers[0].port == 443, 'endpoint');
assert(parse(b64enc(a + '#Name\n')).servers[0].id == data.servers[0].id, 'base64');
let encoded = replace(b64enc(a + '#Name\n'), /=/g, '');
assert(parse(encoded).servers[0].id == data.servers[0].id, 'unpadded base64');
assert(parse(a + '#New name').servers[0].id == data.servers[0].id, 'name does not change identity');
assert(length(parse(a + '#Same\n' + b + '#Same').servers) == 2, 'duplicate names stay distinct');
assert(length(parse(a + '#One\n' + a + '#Two').servers) == 1, 'duplicate connection deduplicated');
assert(parse(a + '#\"<script>\\x41').servers[0].name == '"<script>\\x41', 'fragment stays plain data');
assert(parse(a + '#%09%0AName').servers[0].name == 'Name', 'control characters removed');
assert(parse(a + '#Name\nhttp://not-a-proxy\nvmess://payload').skipped == 2, 'unsupported entries counted');
assert(parse('ss://YWVzLTEyOC1nY206cGFzcw==@ss.example:8388#SS').servers[0].protocol == 'ss', 'SIP002 shadowsocks');
rejects('not base64!', 'malformed base64');
rejects('[]', 'JSON format not silently accepted');
rejects('proxies:\n  - name: example', 'Clash YAML not silently accepted');
rejects('vless://id@one.example:65536#bad', 'invalid port');
rejects('vless://id@-bad.example:443', 'hostname cannot be a shell option');
rejects('vless://id@[::1]:443', 'IPv6 rejected for current Podkop URI parser');
let many = '';
for (let i = 0; i < 257; i++) many += 'vless://id' + i + '@one.example:443#Node\n';
rejects(many, 'node count limit');
printf('Parser: %d checks passed\n', passed);
