import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIOS, unsupportedMessage } from '../public/game/sources/source.js';

const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130.0', platform: 'iPhone', maxTouchPoints: 5 };
const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 };

test('isIOS känner igen iPhone och iPad (som utger sig för att vara Mac)', () => {
  assert.equal(isIOS(iphone), true);
  assert.equal(isIOS(ipad), true);
  assert.equal(isIOS(mac), false);
  assert.equal(isIOS(undefined), false);
});

test('unsupportedMessage föreslår Bluefy på iOS, Chrome/Edge annars', () => {
  assert.match(unsupportedMessage('Web Bluetooth', iphone), /Bluefy/);
  assert.match(unsupportedMessage('WebHID', ipad), /välj Bluetooth.*Bluefy/);
  assert.equal(unsupportedMessage('Web Bluetooth', mac), 'Web Bluetooth saknas – använd Chrome eller Edge');
});
