import { sha256 } from 'digest';

// This is the same set of URI schemes handled by Podkop 0.7.22.
const schemes = ['vless', 'ss', 'trojan', 'socks4', 'socks4a', 'socks5', 'hy2', 'hysteria2'];

function label(fragment) {
    // Fragments follow URI escaping: a literal '+' is not a space.
    let decoded = replace(fragment, /%([0-9a-fA-F]{2})/g,
        function(m, hex) { return chr(int(hex, 16)); });
    return substr(trim(replace(decoded, /[[:cntrl:]]/g, '')), 0, 512);
}

export function connection_id(link) {
    let uri = split(link, '#')[0];
    let query = index(uri, '?');
    if (query < 0) return sha256(uri);
    let pairs = split(substr(uri, query + 1), '&');
    let reality = index(pairs, 'security=reality') >= 0;
    let keys = {}, unique = true;
    pairs = filter(pairs, function(pair) {
        let key = split(pair, '=')[0];
        // Providers may rotate accepted Reality short IDs and spider paths on
        // every fetch. Endpoint, user, public key and SNI still identify it.
        if (reality && (key == 'sid' || key == 'spx')) return false;
        if (keys[key]) unique = false;
        keys[key] = true;
        return true;
    });
    if (unique) sort(pairs);
    return sha256(substr(uri, 0, query) + (length(pairs) ? '?' + join('&', pairs) : ''));
};

export function assign_ids(servers) {
    let counts = {};
    for (let server in servers) counts[server.name] = (counts[server.name] || 0) + 1;
    return map(servers, function(server) {
        let result = {};
        for (let key in keys(server)) result[key] = server[key];
        result.legacy_id = server.id;
        // A unique provider label identifies the logical entry even when its
        // address or credentials rotate. Duplicate labels need a connection ID.
        result.id = sha256('node:' + server.name + (counts[server.name] > 1 ? '\n' + connection_id(server.link) : ''));
        return result;
    });
};

export function parse(raw) {
    if (type(raw) != 'string' || length(raw) > 524288)
        die('Subscription is too large');
    raw = trim(raw);
    if (index(raw, '://') < 0) {
        // Both standard and URL-safe base64; tolerate missing padding.
        raw = replace(replace(replace(raw, /[[:space:]]/g, ''), /-/g, '+'), /_/g, '/');
        while (length(raw) % 4) raw += '=';
        raw = b64dec(raw);
        if (raw == null) die('Invalid base64');
    }
    let result = [], seen = {}, skipped = 0;
    for (let line in split(raw, '\n')) {
        line = trim(line);
        if (!length(line)) continue;
        if (length(line) > 8192 || match(line, /[[:cntrl:][:space:]]/)) {
            // Spaces in the display fragment are common; only the URI itself
            // needs to be free of raw spaces and control characters.
            let uri = split(line, '#')[0];
            if (length(line) > 8192 || match(uri, /[[:cntrl:][:space:]]/)) {
                skipped++; continue;
            }
        }
        let hash = index(line, '#');
        let uri = hash < 0 ? line : substr(line, 0, hash);
        let name = hash < 0 ? '' : label(substr(line, hash + 1));
        let parts = match(uri, /^([a-z0-9]+):\/\/([^/?#]+)(.*)$/);
        if (!parts || index(schemes, parts[1]) < 0) { skipped++; continue; }
        let authority = parts[2], at = rindex(authority, '@');
        // Legacy whole-payload Shadowsocks is not accepted by Podkop either.
        if (at < 1) { skipped++; continue; }
        let endpoint = substr(authority, at + 1);
        let address = match(endpoint, /^([A-Za-z0-9][A-Za-z0-9._-]*):([0-9]{1,5})$/);
        // Podkop 0.7.22's URI parser cannot handle IPv6 literal endpoints.
        // Reject instead of claiming the URI is usable by that version.
        if (!address || int(address[2]) < 1 || int(address[2]) > 65535) {
            skipped++; continue;
        }
        let id = connection_id(uri);
        let duplicate = id + '\n' + name;
        if (seen[duplicate]) continue;
        seen[duplicate] = true;
        if (length(result) >= 256) die('Too many servers (maximum 256)');
        push(result, { id, name: length(name) ? name : address[1] + ':' + address[2],
            host: address[1], port: int(address[2]), protocol: parts[1], link: uri });
    }
    if (!length(result)) die('No supported proxy URIs');
    return { servers: assign_ids(result), skipped };
};
