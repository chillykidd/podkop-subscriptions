import * as fs from 'fs';
import { sha256 } from 'digest';
import { parse } from './parser.uc';

const dir = getenv('PODKOP_SUBSCRIPTIONS_CACHE') || '/tmp/podkop-subscriptions';
function fail(code, message) { return { ok: false, error: code, message }; }
function quote(s) { return "'" + replace(s, /'/g, "'\\''") + "'"; }
function command(cmd) {
    let p = fs.popen(cmd + ' 2>/dev/null', 'r');
    if (!p) die('Unable to start command');
    let output = p.read('all');
    return { output, code: p.close() };
}
function readCache(path) {
    try {
        let st = fs.stat(path);
        if (!st || st.size > 1048576) return null;
        let data = json(fs.readfile(path));
        return type(data.servers) == 'array' ? data : null;
    } catch (e) { return null; }
}
function publicCache(data) {
    return { ok: true, cached: true, fetched_at: data.fetched_at,
        skipped: data.skipped, servers: map(data.servers, function(s) {
            return { id: s.id, name: s.name, host: s.host, port: s.port, protocol: s.protocol };
        }) };
}
function atomicWrite(path, data) {
    // Mutations are serialized by the RPC wrapper's flock.
    let tmp = path + '.tmp';
    let f = fs.open(tmp, 'w', 0600);
    if (!f) die('Unable to write cache');
    let text = sprintf('%J', data);
    let written = f.write(text);
    f.close();
    if (written != length(text) || !fs.rename(tmp, path)) {
        fs.unlink(tmp); die('Unable to save cache');
    }
}
function run(method, request) {
    if (!fs.access('/usr/bin/podkop', 'x') || !fs.stat('/etc/config/podkop'))
        return fail('missing_podkop', 'Дополнение работает только с установленным Podkop.');
    let url = request.url;
    if (type(url) != 'string' || length(url) > 2048 ||
        !match(url, /^https:\/\/[A-Za-z0-9][A-Za-z0-9.:-]*(\/[^[:cntrl:][:space:]]*)?$/))
        return fail('invalid_url', 'Нужна HTTPS-ссылка без логина, пробелов и управляющих символов.');
    fs.mkdir(dir, 0700);
    let path = dir + '/' + sha256(url) + '.json';
    let old = readCache(path);
    if (method == 'cache')
        return old ? publicCache(old) : { ok: true, cached: false, servers: [] };
    if (method == 'refresh') {
        let rawpath = path + '.download';
        // -q disables .curlrc. TLS is always verified; redirects stay on HTTPS.
        let reply = command('curl -q --fail --silent --show-error --location' +
            " --noproxy '*' --proto '=https' --proto-redir '=https'" +
            ' --max-redirs 3 --connect-timeout 4 --max-time 12 --max-filesize 524288' +
            ' --output ' + quote(rawpath) + ' --url ' + quote(url));
        if (reply.code != 0) {
            fs.unlink(rawpath);
            return fail('download_failed', 'Не удалось скачать подписку. Проверьте HTTPS, сертификат и доступность сервера. Сохранённый выбор не изменён.');
        }
        let parsed;
        try { parsed = parse(fs.readfile(rawpath)); }
        catch (e) { fs.unlink(rawpath); return fail('invalid_subscription', 'Подписка не распознана, пуста или превышает лимиты. Поддерживаются списки proxy URI и Base64.'); }
        fs.unlink(rawpath);
        let data = { fetched_at: time(), servers: parsed.servers, skipped: parsed.skipped };
        atomicWrite(path, data);
        // Bound tmpfs use: at most sixteen recently fetched subscriptions.
        let files = filter(fs.glob(dir + '/*.json') || [], function(p) { return p != path; });
        sort(files, function(a, b) { return fs.stat(a).mtime - fs.stat(b).mtime; });
        while (length(files) > 15) fs.unlink(shift(files));
        let result = publicCache(data);
        let prev = old ? map(old.servers, function(s) { return s.id; }) : [];
        let next = map(data.servers, function(s) { return s.id; });
        result.added = old ? filter(next, function(id) { return index(prev, id) < 0; }) : [];
        result.removed = filter(prev, function(id) { return index(next, id) < 0; });
        return result;
    }
    if (type(request.server) != 'string' || !match(request.server, /^[0-9a-f]{64}$/))
        return fail('invalid_server', 'Неверный идентификатор сервера.');
    if (!old) return fail('no_cache', 'Сначала обновите подписку.');
    let matches = filter(old.servers, function(s) { return s.id == request.server; });
    if (!length(matches)) return fail('missing_server', 'Выбранный сервер отсутствует в подписке. Выберите другой вручную.');
    let server = matches[0];
    if (method == 'resolve') return { ok: true, link: server.link };
    if (method == 'probe') {
        // This measures ICMP reachability, never proxy authentication or speed.
        let response = command('ping -c 1 -W 2 -w 3 ' + quote(server.host));
        let latency = match(response.output || '', /time[=<]([0-9.]+)[[:space:]]*ms/);
        if (response.code != 0 || !latency)
            return fail('no_icmp', 'Нет ответа ICMP; прокси при этом может работать.');
        return { ok: true, id: server.id, ms: +latency[1], method: 'icmp' };
    }
    return fail('unknown_method', 'Неизвестная команда.');
}

try {
    let input = fs.stdin.read(65537);
    if (length(input) > 65536) die('Request is too large');
    let request = json(input);
    if (type(request) != 'object') die('Invalid request');
    print(sprintf('%J\n', run(ARGV[0], request)));
} catch (e) {
    // Do not echo exception text: URLs and credentials must not reach logs/UI.
    print(sprintf('%J\n', fail('internal_error', 'Не удалось обработать запрос.')));
}
