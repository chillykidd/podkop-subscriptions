import * as fs from 'fs';
import { sha256 } from 'digest';

const target = getenv('PODKOP_SUBSCRIPTIONS_SECTION') || '/www/luci-static/resources/view/podkop/section.js';
const backupDir = getenv('PODKOP_SUBSCRIPTIONS_BACKUP') || '/etc/podkop-subscriptions/integration';
const marker = '/* podkop-subscriptions hook v2 */';
const mode = ARGV[0] || 'check';
const source = fs.readfile(target);
if (source == null) die('Podkop LuCI section view is missing');

function write(path, data, permissions) {
    let f = fs.open(path + '.tmp', 'w', permissions);
    if (!f) die('Unable to create file');
    let count = f.write(data); f.close();
    // The installer uses umask 077 for credentials, but LuCI must be able to
    // serve the patched JS file. Apply the requested mode after file creation.
    if (!fs.chmod(path + '.tmp', permissions)) die('Unable to set file permissions');
    if (count != length(data) || !fs.rename(path + '.tmp', path)) die('Unable to save file');
}

if (mode == 'remove') {
    const installed = trim(fs.readfile(backupDir + '/installed.sha256') || '');
    const original = fs.readfile(backupDir + '/section.original.js');
    if (index(source, marker) < 0) { print('Podkop section view is already unpatched\n'); exit(0); }
    if (!original || sha256(source) != installed)
        die('Podkop section view changed after installation; refusing to overwrite it. Restore from backup manually.');
    write(target, original, 0644);
    print('Restored original Podkop section view\n'); exit(0);
}
if (index(source, marker) >= 0) {
    if (mode == 'install') fs.chmod(target, 0644);
    print('Podkop integration already installed\n'); exit(0);
}

let patched = replace(source, /\r\n/g, '\n');
// Adapt the user's earlier inline implementation, retaining all unrelated
// routing fields. An upstream section view simply skips these removals.
const oldStart = index(patched, 'const subscriptionMemory = {};');
if (oldStart >= 0) {
    const coreStart = index(patched, 'function createSectionContent(section)');
    if (coreStart < oldStart) die('Unknown legacy subscription integration');
    patched = substr(patched, 0, oldStart) + substr(patched, coreStart);
    const fieldsStart = index(patched, '  let subscriptionServerOption;');
    const proxyStart = index(patched, '    "proxy_config_type",');
    if (fieldsStart < 0 || proxyStart < fieldsStart) die('Unknown legacy fields');
    const nextField = rindex(substr(patched, 0, proxyStart), '  o = section.option(');
    if (nextField <= fieldsStart) die('Unknown proxy fields');
    patched = substr(patched, 0, fieldsStart) + substr(patched, nextField);
    patched = replace(patched, '  o.value("subscription", "Подписка");\n', '');
}
// Keep this hook small and refuse unknown layouts, rather than overwriting an
// arbitrary Podkop release with a bundled full copy of its view.
const exportBlock = /const EntryPoint = \{[[:space:]]*createSectionContent,[[:space:]]*\};/;
if (!match(patched, exportBlock) || !match(patched, /function createSectionContent\(section\)/))
    die('Unsupported Podkop section view layout; no files changed');
patched = marker + '\n"require view.podkop.subscriptions as subscriptions";\n' +
    replace(patched, exportBlock, 'const EntryPoint = {\n  createSectionContent: function(section) {\n    createSectionContent(section);\n    subscriptions.attach(section);\n  },\n};');
if (mode == 'check') { print('Podkop integration layout supported\n'); exit(0); }
if (mode != 'install') die('Unknown integration command');
fs.mkdir(backupDir, 0700);
// A new upstream file gets a new backup on reintegration, even if the add-on
// had been installed before a Podkop upgrade.
write(backupDir + '/section.original.js', source, 0600);
write(backupDir + '/installed.sha256', sha256(patched) + '\n', 0600);
write(target, patched, 0644);
print('Integrated subscriptions into Podkop section view\n');
