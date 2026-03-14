import { Howl } from "howler";

const cache = new Map<string, Howl>();

export function playSound(file: string) {
  let sound = cache.get(file);
  if (!sound) {
    sound = new Howl({ src: [`/sounds/${file}`], volume: 1.0 });
    cache.set(file, sound);
  }
  sound.play();
}
