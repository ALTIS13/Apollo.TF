const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { constants, lstatSync, openSync, readFileSync, closeSync } = require('node:fs');

const catalogPath = '/run/tf-reviewed/catalog.json';
const mediaDir = '/run/tf-reviewed/media';
const expectedCatalog = '07de1d352d24cb436ea78a27530f65cb8415a437cbc07be8b1b67743451e56a2';
const expectedMedia = 'ae4e304cde343904b881983502c88fbd4464251301f9dcbe382f28b655a6a803';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function requireCondition(value) { if (!value) throw new Error('Invalid fixture'); }
function read(path, length) {
  const info = lstatSync(path);
  requireCondition(info.isFile() && info.size === length);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { return readFileSync(fd); } finally { closeSync(fd); }
}
try {
  requireCondition(process.getuid() === 10001 && process.getgid() === 10001 && !process.getgroups().includes(0));
  const mounts = readFileSync('/proc/self/mountinfo', 'utf8').split('\n').map((row) => row.split(' '));
  for (const target of [catalogPath, mediaDir]) {
    const record = mounts.filter((row) => row[4] === target);
    requireCondition(record.length === 1 && record[0][5].split(',').includes('ro'));
  }
  const catalogBytes = read(catalogPath, 1339);
  requireCondition(hash(catalogBytes) === expectedCatalog);
  const catalog = JSON.parse(catalogBytes);
  const [track] = catalog.entries;
  requireCondition(catalog.schemaVersion === 1 && catalog.entries.length === 1 && track.edition === 'original' &&
    track.mediaKind === 'full' && track.streamPermission === 'permitted' && track.downloadPermission === 'permitted' &&
    track.media.format === 'ogg' && track.media.sha256 === expectedMedia);
  const media = read(`${mediaDir}/${expectedMedia}.ogg`, 3194811);
  requireCondition(hash(media) === expectedMedia);
  const pcm = execFileSync('/usr/bin/ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-threads', '1',
    '-protocol_whitelist', 'pipe', '-f', 'ogg', '-i', 'pipe:0', '-map', '0:a', '-vn', '-sn', '-dn', '-ac', '1',
    '-ar', '8000', '-f', 's16le', 'pipe:1'], { input: media, maxBuffer: 3200000, timeout: 20000 });
  const decodedSeconds = Math.round(pcm.length / 16) / 1000;
  requireCondition(decodedSeconds === 173.533);
  console.log(JSON.stringify({ evidence: 'isolated-api-image-fixture', uid: process.getuid(), gid: process.getgid(),
    readOnlyBinds: 2, catalogSha256: expectedCatalog, mediaSha256: expectedMedia, decodedSeconds }));
} catch (error) {
  if (error.code === 'EACCES') { console.error('fixture_unreadable'); process.exitCode = 23; }
  else { console.error('fixture_invalid'); process.exitCode = 24; }
}
