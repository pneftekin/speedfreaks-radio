import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import dns from 'node:dns';
import net from 'node:net';

dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);

const app = express();
const port = Number(process.env.BACKEND_PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const sessionCookieName = 'speedfreaks_session';
const oauthStateCookieName = 'speedfreaks_oauth_state';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;

const requiredEnvironment = [
  'LASTFM_API_KEY',
  'LASTFM_API_SECRET',
  'LASTFM_CALLBACK_URL',
  'SESSION_SECRET',
];

for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

const databasePath = process.env.SESSION_DATABASE_PATH || 'data/sessions.sqlite';
fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    lastfm_session_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);

const insertSession = database.prepare(`
  INSERT OR REPLACE INTO sessions (id_hash, username, lastfm_session_key, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?)
`);
const selectSession = database.prepare(`
  SELECT username, lastfm_session_key FROM sessions WHERE id_hash = ? AND expires_at > ?
`);
const deleteSession = database.prepare('DELETE FROM sessions WHERE id_hash = ?');

app.use(express.json({ limit: '4kb' }));

function parseCookies(request) {
  const cookies = {};
  for (const part of (request.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1));
  }
  return cookies;
}

function cookieOptions(maxAge, secure = isProduction) {
  return [
    `${sessionCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function stateCookie(value) {
  return [
    `${oauthStateCookieName}=${encodeURIComponent(value)}`,
    'Path=/api/lastfm',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
    ...(isProduction ? ['Secure'] : []),
  ].join('; ');
}

function hashSessionId(sessionId) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(sessionId).digest('hex');
}

function createSession(username, lastfmSessionKey) {
  const sessionId = crypto.randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  insertSession.run(hashSessionId(sessionId), username, lastfmSessionKey, now, now + sessionMaxAgeSeconds);
  return sessionId;
}

function redirectWithError(response, code) {
  response.redirect(`/?lastfm_error=${encodeURIComponent(code)}`);
}

function signedLastfmParameters(parameters) {
  const signatureBase = Object.keys(parameters)
    .sort()
    .map((key) => `${key}${parameters[key]}`)
    .join('');
  return crypto.createHash('md5').update(`${signatureBase}${process.env.LASTFM_API_SECRET}`, 'utf8').digest('hex');
}

function logLastfmFailure(method, httpStatus, body = {}) {
  const diagnostic = { method, httpStatus };
  if (Number.isInteger(body.error)) diagnostic.errorCode = body.error;
  if (typeof body.message === 'string') diagnostic.errorMessage = body.message.slice(0, 500);
  console.error('[Last.fm request failed]', diagnostic);
}

function getAuthenticatedSession(request) {
  const sessionId = parseCookies(request)[sessionCookieName];
  if (!sessionId) return null;
  return selectSession.get(hashSessionId(sessionId), Math.floor(Date.now() / 1000)) || null;
}

async function callLastfm(parameters) {
  const signedParameters = {
    api_key: process.env.LASTFM_API_KEY,
    ...parameters,
  };
  const body = new URLSearchParams({
    ...signedParameters,
    api_sig: signedLastfmParameters(signedParameters),
    format: 'json',
  });
  let result;
  let responseBody = {};
  try {
    result = await fetch('https://ws.audioscrobbler.com/2.0/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    try {
      responseBody = await result.json();
    } catch {
      responseBody = {};
    }
  } catch {
    logLastfmFailure(parameters.method, 'network_error');
    throw new Error('Last.fm request unavailable.');
  }

  if (result.status >= 400 || responseBody.error) {
    logLastfmFailure(parameters.method, result.status, responseBody);
  }
  return { httpStatus: result.status, body: responseBody };
}

function clearAuthenticatedSession(request, response) {
  const sessionId = parseCookies(request)[sessionCookieName];
  if (sessionId) deleteSession.run(hashSessionId(sessionId));
  response.setHeader('Set-Cookie', cookieOptions(0));
}

function validateTrackPayload(body, includeTimestamp = false) {
  const artist = typeof body?.artist === 'string' ? body.artist.trim() : '';
  const track = typeof body?.track === 'string' ? body.track.trim() : '';
  const duration = Number(body?.duration);
  const listeningStart = Number(body?.listeningStart);
  const trackIdentity = typeof body?.trackIdentity === 'string' ? body.trackIdentity : '';

  if (!artist || !track || artist.length > 300 || track.length > 300) return null;
  if (!trackIdentity || trackIdentity.length > 500) return null;
  if (includeTimestamp && (!Number.isInteger(listeningStart) || listeningStart < 0)) return null;

  return {
    artist,
    track,
    duration: Number.isFinite(duration) && duration > 0 && duration <= 86400 ? Math.floor(duration) : undefined,
    listeningStart,
    trackIdentity,
  };
}

app.get('/api/lastfm/connect', (request, response) => {
  const state = crypto.randomBytes(24).toString('base64url');
  const authorizationUrl = new URL('https://www.last.fm/api/auth/');
  authorizationUrl.searchParams.set('api_key', process.env.LASTFM_API_KEY);
  authorizationUrl.searchParams.set('cb', process.env.LASTFM_CALLBACK_URL);
  authorizationUrl.searchParams.set('state', state);
  response.setHeader('Set-Cookie', stateCookie(state));
  response.redirect(authorizationUrl.toString());
});

app.get('/api/lastfm/callback', async (request, response) => {
  const { token } = request.query;
  const cookies = parseCookies(request);
  const expectedState = cookies[oauthStateCookieName];

  if (!token || !expectedState || (request.query.state && request.query.state !== expectedState)) {
    return redirectWithError(response, 'lastfm_auth_failed');
  }

  const parameters = {
    api_key: process.env.LASTFM_API_KEY,
    method: 'auth.getSession',
    token,
  };
  const apiUrl = new URL('https://ws.audioscrobbler.com/2.0/');
  for (const [key, value] of Object.entries({ ...parameters, api_sig: signedLastfmParameters(parameters), format: 'json' })) {
    apiUrl.searchParams.set(key, value);
  }

  try {
    const lastfmResponse = await fetch(apiUrl);
    const result = await lastfmResponse.json();
    const session = result?.session;
    if (!lastfmResponse.ok || result?.error || !session?.name || !session?.key) {
      logLastfmFailure('auth.getSession', lastfmResponse.status, result);
      return redirectWithError(response, 'lastfm_auth_failed');
    }

    const sessionId = createSession(session.name, session.key);
    response.setHeader('Set-Cookie', [
      `${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}${isProduction ? '; Secure' : ''}`,
      `${oauthStateCookieName}=; Path=/api/lastfm; HttpOnly; SameSite=Lax; Max-Age=0${isProduction ? '; Secure' : ''}`,
    ]);
    return response.redirect('/');
  } catch {
    logLastfmFailure('auth.getSession', 'network_error');
    return redirectWithError(response, 'lastfm_auth_failed');
  }
});

app.get('/api/lastfm/me', (request, response) => {
  const session = getAuthenticatedSession(request);
  if (!session) return response.json({ connected: false });
  return response.json({ connected: true, username: session.username });
});

app.post('/api/lastfm/disconnect', (request, response) => {
  clearAuthenticatedSession(request, response);
  return response.json({ connected: false });
});

app.post('/api/lastfm/now-playing', async (request, response) => {
  const session = getAuthenticatedSession(request);
  if (!session) return response.status(401).json({ connected: false });

  const track = validateTrackPayload(request.body);
  if (!track) return response.status(400).json({ error: 'Invalid track metadata.' });

  try {
    const result = await callLastfm({
      method: 'track.updateNowPlaying',
      sk: session.lastfm_session_key,
      artist: track.artist,
      track: track.track,
      ...(track.duration ? { duration: track.duration } : {}),
    });
    if (result.body?.error === 9) {
      clearAuthenticatedSession(request, response);
      return response.status(401).json({ connected: false, error: 'lastfm_session_invalid' });
    }
    if (result.httpStatus >= 400 || result.body?.error) return response.status(502).json({ error: 'Last.fm update failed.' });
    return response.json({ connected: true });
  } catch {
    return response.status(502).json({ error: 'Last.fm update unavailable.' });
  }
});

app.post('/api/lastfm/scrobble', async (request, response) => {
  const session = getAuthenticatedSession(request);
  if (!session) return response.status(401).json({ connected: false });

  const track = validateTrackPayload(request.body, true);
  const now = Math.floor(Date.now() / 1000);
  if (!track || track.listeningStart > now || now - track.listeningStart > 86400) {
    return response.status(400).json({ error: 'Invalid scrobble metadata.' });
  }

  try {
    const result = await callLastfm({
      method: 'track.scrobble',
      sk: session.lastfm_session_key,
      artist: track.artist,
      track: track.track,
      timestamp: track.listeningStart,
      chosenByUser: 0,
      ...(track.duration ? { duration: track.duration } : {}),
    });
    if (result.body?.error === 9) {
      clearAuthenticatedSession(request, response);
      return response.status(401).json({ connected: false, error: 'lastfm_session_invalid' });
    }
    if (result.httpStatus >= 400 || result.body?.error) return response.status(502).json({ error: 'Last.fm scrobble failed.' });
    return response.json({ connected: true, scrobbled: true });
  } catch {
    return response.status(502).json({ error: 'Last.fm scrobble unavailable.' });
  }
});

app.listen(port, () => {
  console.log(`Last.fm backend listening on port ${port}`);
});