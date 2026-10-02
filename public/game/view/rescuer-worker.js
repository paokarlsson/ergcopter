// Målar räddaren på klippan i en egen tråd, så att huvudtråden kan fortsätta rita spelet (view/rescuer.js).
import { paintRescuerScene } from './rescuer.js';

self.onmessage = (e) => {
  const { w, h, detail } = e.data;
  const canvas = new OffscreenCanvas(w, h);
  paintRescuerScene(canvas.getContext('2d'), w, h, detail);
  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({ w, h, bitmap }, [bitmap]);
};
