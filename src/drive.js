/**
 * Stores resumes in the company Google Drive:
 *
 *   My Drive / Aakar Internship Aptitude Test - Resumes / <College name> / <Student name> - <contact>.pdf
 *
 * Uses OAuth with a long-lived refresh token of the Google account that should OWN the resumes
 * (service accounts cannot upload into a normal "My Drive", so a refresh token is used).
 * Scope needed: https://www.googleapis.com/auth/drive.file  (the app only sees files/folders it created itself)
 */
const { Readable } = require('stream');
const { HttpError } = require('./utils/helpers');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_NAME = process.env.DRIVE_ROOT_FOLDER_NAME || 'Aakar Internship Aptitude Test - Resumes';

let driveClient;
const folderCache = new Map(); // "parentId/name" -> folderId  (lives as long as the function instance is warm)

function getDrive() {
  if (driveClient) return driveClient;
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new HttpError(500, 'Google Drive is not configured on the server');
  }
  // eslint-disable-next-line global-require
  const { drive } = require('@googleapis/drive');
  // eslint-disable-next-line global-require
  const { OAuth2Client } = require('google-auth-library');
  const auth = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  driveClient = drive({ version: 'v3', auth });
  return driveClient;
}

const escapeQuery = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const safeName = (s, max = 80) => String(s).replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || 'Unknown';

async function ensureFolder(drive, name, parentId) {
  const key = `${parentId || 'root'}/${name}`;
  if (folderCache.has(key)) return folderCache.get(key);

  const q = [
    `mimeType='${FOLDER_MIME}'`,
    `name='${escapeQuery(name)}'`,
    'trashed=false',
    `'${parentId || 'root'}' in parents`,
  ].join(' and ');
  const found = await drive.files.list({ q, fields: 'files(id)', pageSize: 1, spaces: 'drive' });
  let id = found.data.files && found.data.files[0] && found.data.files[0].id;
  if (!id) {
    const created = await drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined },
      fields: 'id',
    });
    id = created.data.id;
  }
  folderCache.set(key, id);
  return id;
}

/** Uploads one resume. Returns { fileId, url } where url opens the file in Drive (only for the owner account). */
async function uploadResume({ buffer, mimeType, ext, collegeName, studentName, contact }) {
  if (process.env.USE_MEMORY_DB === '1') return { fileId: 'memory-file', url: 'https://drive.google.com/file/d/memory-file/view' };

  const drive = getDrive();
  try {
    const rootId = await ensureFolder(drive, ROOT_NAME, null);
    const collegeId = await ensureFolder(drive, safeName(collegeName, 100), rootId);
    const res = await drive.files.create({
      requestBody: { name: `${safeName(studentName)} - ${safeName(contact, 20)}.${ext}`, parents: [collegeId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id, webViewLink',
    });
    return { fileId: res.data.id, url: res.data.webViewLink };
  } catch (e) {
    // A trashed / deleted folder makes cached ids stale - forget them so the next try recreates the folders
    folderCache.clear();
    console.error('Drive upload failed:', e.message);
    throw new HttpError(502, 'Could not save your resume right now. Please try again in a moment.');
  }
}

/** Moves a resume to the Drive trash (recoverable for 30 days). Never throws: the student record is deleted either way. */
async function trashResume(fileId) {
  if (!fileId || process.env.USE_MEMORY_DB === '1') return false;
  try {
    await getDrive().files.update({ fileId, requestBody: { trashed: true } });
    return true;
  } catch (e) {
    console.error('Could not move the resume to the Drive trash:', e.message);
    return false;
  }
}

module.exports = { uploadResume, trashResume };
