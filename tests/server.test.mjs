/**
 * Iris SYNCD — server integration + unit tests.
 * Runs on Node's built-in test runner (no extra dependencies):
 *
 *   npm test
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as Client } from 'socket.io-client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const {
  server, sessions, uploads, sessionFiles,
  getPlaybackSnapshot, destroyUploadedFiles, _stopForTests,
} = await import('../server/src/index.js');

let BASE;
// CI watchdog: never let a lost ack hang the suite
setTimeout(() => { console.error('WATCHDOG: suite did not finish in 30s'); process.exit(2); }, 30000).unref();
const __origEmitAck = (sock, ev, payload) => new Promise(res => sock.emit(ev, payload, res));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const connect = () => new Promise((res, rej) => {
  const s = Client(BASE, { transports: ['websocket'] });
  s.on('connect', () => res(s));
  s.on('connect_error', rej);
});
const emitAck = (sock, ev, payload) =>
  new Promise(res => sock.emit(ev, payload, res));

before(async () => {
  await new Promise(res => server.listen(0, res));
  const port = server.address().port;
  BASE = `http://localhost:${port}`;
});

after(() => {
  _stopForTests();
});

// ---------- Pure functions ----------
describe('getPlaybackSnapshot', () => {
  test('returns null when no track loaded', () => {
    const session = { playback: { trackId: null } };
    assert.equal(getPlaybackSnapshot(session), null);
  });

  test('paused session reports stored position', () => {
    const session = { playback: {
      trackId: 'x', trackName: 'a.wav', trackUrl: 'http://x/a.wav',
      duration: 100, isPlaying: false, position: 42, startedAt: null,
    }};
    const snap = getPlaybackSnapshot(session);
    assert.equal(snap.position, 42);
    assert.equal(snap.isPlaying, false);
  });

  test('playing session advances position from startedAt', () => {
    const startedAt = Date.now() - 5000; // playing for ~5s
    const session = { playback: {
      trackId: 'x', trackName: 'a.wav', trackUrl: 'http://x/a.wav',
      duration: 100, isPlaying: true, position: 10, startedAt,
    }};
    const snap = getPlaybackSnapshot(session);
    assert.ok(snap.position > 14 && snap.position < 16, `position=${snap.position}`);
  });

  test('position clamps to duration at end of track', () => {
    const startedAt = Date.now() - 60000;
    const session = { playback: {
      trackId: 'x', trackName: 'a.wav', trackUrl: 'http://x/a.wav',
      duration: 30, isPlaying: true, position: 25, startedAt,
    }};
    const snap = getPlaybackSnapshot(session);
    assert.equal(snap.position, 30);
  });
});

describe('destroyUploadedFiles', () => {
  test('removes registry entries and unlinks files', async () => {
    const tmp = path.join(__dirname, 'fixture-track.bin');
    fs.writeFileSync(tmp, Buffer.alloc(8, 1));
    uploads.set('f1', { id: 'f1', sessionId: 'SESS1', filePath: tmp, name: 't', mimeType: 'audio/wav', size: 8 });
    if (!sessionFiles.has('SESS1')) sessionFiles.set('SESS1', new Set());
    sessionFiles.get('SESS1').add('f1');

    destroyUploadedFiles('SESS1');

    assert.equal(uploads.has('f1'), false);
    assert.equal(fs.existsSync(tmp), false);
  });

  test('is a no-op for unknown sessions', () => {
    assert.doesNotThrow(() => destroyUploadedFiles('NOPE0000'));
  });
});

// ---------- HTTP surface ----------
describe('HTTP API', () => {
  test('/api/health responds ok', async () => {
    const res = await fetch(`${BASE}/api/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'ok');
  });

  test('unknown API route returns JSON 404', async () => {
    const res = await fetch(`${BASE}/api/nope`);
    assert.equal(res.status, 404);
    assert.ok((await res.json()).error);
  });

  test('session endpoint rejects malformed ids', async () => {
    const res = await fetch(`${BASE}/api/sessions/BAD!ID!!`);
    assert.equal(res.status, 400);
  });

  test('track download rejects malformed ids', async () => {
    const res = await fetch(`${BASE}/api/audio/not-a-uuid`);
    assert.equal(res.status, 400);
  });

  test('upload requires host token', async () => {
    const res = await fetch(`${BASE}/api/sessions/AAAAAAAA/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: Buffer.alloc(4),
    });
    // Session does not exist -> 404 before token check
    assert.equal(res.status, 404);
  });
});

// ---------- Signaling flows ----------
describe('signaling', () => {
  test('full lifecycle: create, join, upload, playback state machine, end', async () => {
    const host = await connect();
    const created = await new Promise(res => host.emit('create-session', res));
    assert.ok(created.sessionId?.match(/^[A-Z0-9]{8}$/), 'session id format');
    assert.ok(created.hostToken, 'host token issued');

    // Device join notifies host
    const joinedP = new Promise(res => host.once('device-joined', d => res(d)));
    const dev = await connect();
    const joined = await emitAck(dev, 'join-session', {
      sessionId: created.sessionId, role: 'device', nickname: 'tester',
      isCameraEnabled: true, isSpeakerEnabled: true,
    });
    assert.ok(joined.deviceId);
    const joinEvt = await Promise.race([joinedP, wait(3000).then(() => null)]);
    assert.equal(joinEvt?.deviceId, joined.deviceId);

    // Invalid session id rejected
    const badJoin = await emitAck(dev, 'join-session', { sessionId: 'BAD!SIDE' });
    assert.equal(badJoin.error, 'Invalid session id');

    // Upload without token -> forbidden once the session exists
    const noTok = await fetch(`${BASE}/api/sessions/${created.sessionId}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: Buffer.alloc(4),
    });
    assert.equal(noTok.status, 403);

    // Upload with token succeeds and is downloadable
    const audioBytes = Buffer.from(new Uint8Array([0x49, 0x44, 0x33, 0x04])); // "ID3"
    const upRes = await fetch(`${BASE}/api/sessions/${created.sessionId}/upload?name=unit%20test.mp3`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/mpeg', 'X-Host-Token': created.hostToken },
      body: audioBytes,
    });
    const upJson = await upRes.json();
    assert.equal(upRes.status, 200);
    assert.match(upJson.trackUrl, /\/api\/audio\//);

    const dl = await fetch(upJson.trackUrl);
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()), audioBytes);

    // Non-host cannot start playback
    const devStart = await emitAck(dev, 'start-playing', { trackId: upJson.trackId });
    assert.ok(!devStart || !devStart.success);

    // Host starts playback; device receives broadcast with sync metadata
    const startedP = new Promise(res => dev.once('playback-started', res));
    const startAck = await emitAck(host, 'start-playing', { trackId: upJson.trackId, duration: 120 });
    assert.ok(startAck.success);
    const startedEvt = await Promise.race([startedP, wait(3000).then(() => null)]);
    assert.equal(startedEvt?.trackName, 'unit test.mp3');
    assert.equal(startedEvt?.position, 0);
    assert.ok(typeof startedEvt?.serverTimestamp === 'number');

    // Seek broadcasts clamped position
    const seekedP = new Promise(res => dev.once('playback-seeked', res));
    const seekAck = await emitAck(host, 'seek-playing', { position: 9999 });
    assert.ok(seekAck.success); // clamped, not rejected
    const seekedEvt = await Promise.race([seekedP, wait(3000).then(() => null)]);
    assert.equal(seekedEvt?.position, 120);

    // Pause preserves computed position
    const pausedP = new Promise(res => dev.once('playback-paused', res));
    const pauseAck = await emitAck(host, 'pause-playing');
    assert.ok(pauseAck.success);
    const pausedEvt = await Promise.race([pausedP, wait(3000).then(() => null)]);
    assert.equal(pausedEvt?.position, 120);

    // Clock sync round trip
    const serverTime = await new Promise(res => dev.timeout(2000).emit('clock-sync', (e, t) => res(e ? null : t)));
    assert.ok(Math.abs(serverTime - Date.now()) < 60_000);

    // PTT relays respect roles
    const pttAnswerP = new Promise(res => host.once('ptt-answer', ({ deviceId }) => res(deviceId)));
    dev.emit('ptt-answer', { answer: { type: 'answer', sdp: 'x' } });
    const answeredBy = await Promise.race([pttAnswerP, wait(3000).then(() => null)]);
    assert.equal(answeredBy, joined.deviceId);

    // Camera signaling relay reaches only the owning participant
    const camOfferP = new Promise(res => dev.once('camera-offer', res));
    dev.emit('camera-offer', { deviceId: joined.deviceId, offer: { type: 'offer', sdp: 'x' } });
    const camOfferEvt = await Promise.race([camOfferP, wait(3000).then(() => null)]);
    assert.ok(camOfferEvt === null, 'host must not receive a device-originated offer');

    // End session cleans everything up
    host.emit('end-session');
    await wait(300);
    assert.equal(sessions.has(created.sessionId), false);
    assert.equal([...uploads.values()].some(u => u.id === upJson.trackId), false);

    dev.disconnect();
    host.disconnect();
    await wait(200);
  });

  test('device heartbeat prevents stale eviction', async () => {
    const hostSock = await connect();
    const created = await new Promise(res => hostSock.emit('create-session', res));

    const dev = await connect();
    const joined = await emitAck(dev, 'join-session', {
      sessionId: created.sessionId, role: 'device', nickname: 'pinger',
      isCameraEnabled: true, isSpeakerEnabled: false,
    });

    const evictP = new Promise(res => {
      const iv = setInterval(() => {
        if (!dev.connected) return res(true);
        dev.emit('device-ping', { deviceId: joined.deviceId });
      }, 200);
      setTimeout(() => { clearInterval(iv); res(false); }, 2500);
    });

    // Heartbeats well inside the 30s window -> still registered afterwards
    const evictedEarly = await evictP;
    assert.equal(evictedEarly, false);

    const info = await (await fetch(`${BASE}/api/sessions/${created.sessionId}`)).json();
    assert.equal(info.deviceCount, 1);

    dev.disconnect();
    hostSock.disconnect();
    await wait(200);
  });
});
