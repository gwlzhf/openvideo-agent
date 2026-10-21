// Serves dist/ for a browser: node preview-film.mjs (set FILM_PORT to pin the port). Preview has no audio.
import {serve} from './static-server.mjs';

const {url} = await serve(Number(process.env.FILM_PORT ?? 0));
console.log(`${url} — in the console: await seek(seconds), or playFilm() / stopFilm(). Preview has no audio.`);
