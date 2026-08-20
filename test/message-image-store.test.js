'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { createMessageImageStore } = require('../src/message-image-store');

const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('message image uploads are normalized to a persistent PNG', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-message-image-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createMessageImageStore({
    profileStorePath: path.join(directory, 'profiles.json')
  });

  const saved = await store.save({
    profileId: 'message_main',
    fileName: 'photo.png',
    mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${ONE_PIXEL_PNG}`
  });

  assert.equal(saved.path, path.join(directory, 'uploads', 'message_main.png'));
  assert.equal(fs.existsSync(saved.path), true);
  const metadata = await sharp(saved.path).metadata();
  assert.equal(metadata.format, 'png');

  const removed = store.remove('message_main');
  assert.equal(removed.removed, true);
  assert.equal(fs.existsSync(saved.path), false);
});

test('message image uploads reject non-image data', async () => {
  const store = createMessageImageStore({ profileStorePath: '/tmp/profiles.json' });
  await assert.rejects(
    store.save({
      profileId: 'message_main',
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      dataUrl: 'data:text/plain;base64,SGVsbG8='
    }),
    /Unsupported image type/
  );
});
