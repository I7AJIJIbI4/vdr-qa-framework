import type { APIRequestContext, APIResponse } from '@playwright/test';
import type {
  Breadcrumbs,
  ContentItem,
  DataRoom,
  FileDetail,
  Folder,
  Page,
  ReceivedShare,
  ResourceType,
  Share,
  ShareMode,
  UploadIntent,
} from './types';

/** Status + parsed body. Tests assert on `status` explicitly - no hidden throws. */
export interface Res<T> {
  status: number;
  body: T;
}

async function toRes<T>(response: APIResponse): Promise<Res<T>> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // non-JSON body stays as text
  }
  return { status: response.status(), body: body as T };
}

/** Throws with the response body when a setup call does not return the expected status. */
export function must<T>(res: Res<T>, expected = [200, 201, 204]): T {
  if (!expected.includes(res.status)) {
    throw new Error(`Setup call failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * Thin, typed wrapper over the Data Room REST API. One instance per actor:
 * `token` is the actor's JWT, or undefined for an anonymous caller.
 */
export class VdrApi {
  constructor(
    private readonly http: APIRequestContext,
    readonly token?: string,
  ) {}

  as(token?: string): VdrApi {
    return new VdrApi(this.http, token);
  }

  private headers(): Record<string, string> {
    return this.token ? { authorization: `Bearer ${this.token}` } : {};
  }

  private async call<T>(method: string, path: string, data?: unknown): Promise<Res<T>> {
    const response = await this.http.fetch(path, { method, headers: this.headers(), data });
    return toRes<T>(response);
  }

  /** Escape hatch for negative/contract tests that must send a body the typed methods can't express. */
  raw<T = unknown>(method: string, path: string, data?: unknown) {
    return this.call<T>(method, path, data);
  }

  // --- auth
  register(body: { name: string; email: string; password: string }) {
    return this.call<{ accessToken: string }>('POST', '/auth/register', body);
  }
  login(body: { email: string; password: string }) {
    return this.call<{ accessToken: string }>('POST', '/auth/login', body);
  }
  me() {
    return this.call<{ id: string; email: string; name: string }>('GET', '/auth/me');
  }

  // --- data rooms
  createDataRoom(name: string) {
    return this.call<DataRoom>('POST', '/data-rooms', { name });
  }
  listDataRooms() {
    return this.call<Page<DataRoom>>('GET', '/data-rooms');
  }
  getDataRoom(id: string) {
    return this.call<DataRoom & { accessLevel: string }>('GET', `/data-rooms/${id}`);
  }
  roomContents(id: string, query = '') {
    return this.call<Page<ContentItem>>('GET', `/data-rooms/${id}/contents${query}`);
  }

  // --- folders
  createFolder(body: { name: string; dataRoomId: string; parentId?: string }) {
    return this.call<Folder>('POST', '/folders', body);
  }
  folderContents(id: string, query = '') {
    return this.call<Page<ContentItem>>('GET', `/folders/${id}/contents${query}`);
  }
  breadcrumbs(id: string) {
    return this.call<Breadcrumbs>('GET', `/folders/${id}/breadcrumbs`);
  }
  deletePreview(id: string) {
    return this.call<{ folderCount: number; fileCount: number; totalSize: number }>(
      'GET',
      `/folders/${id}/delete-preview`,
    );
  }
  renameFolder(id: string, name: string) {
    return this.call<Folder>('PATCH', `/folders/${id}`, { name });
  }
  deleteFolder(id: string) {
    return this.call<void>('DELETE', `/folders/${id}`);
  }

  // --- files
  uploadIntent(body: { dataRoomId: string; folderId?: string; name: string; size: number; mimeType: string }) {
    return this.call<UploadIntent>('POST', '/files/upload-intent', body);
  }
  completeUpload(id: string) {
    return this.call<{ id: string; name: string; folderId: string | null }>('POST', `/files/${id}/complete`);
  }
  getFile(id: string) {
    return this.call<FileDetail>('GET', `/files/${id}`);
  }
  viewUrl(id: string) {
    return this.call<{ url: string }>('GET', `/files/${id}/view-url`);
  }
  downloadUrl(id: string) {
    return this.call<{ url: string }>('GET', `/files/${id}/download-url`);
  }
  renameFile(id: string, name: string) {
    return this.call<FileDetail>('PATCH', `/files/${id}`, { name });
  }
  moveFile(id: string, targetFolderId: string | null) {
    return this.call<FileDetail>('PATCH', `/files/${id}/move`, { targetFolderId });
  }
  deleteFile(id: string) {
    return this.call<void>('DELETE', `/files/${id}`);
  }

  /** PUTs bytes to a signed storage URL the same way the web client does (multipart form). */
  async putToStorage(uploadUrl: string, bytes: Buffer, contentType = 'application/pdf'): Promise<number> {
    const response = await this.http.fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'x-upsert': 'false' },
      multipart: {
        cacheControl: '3600',
        '': { name: 'file', mimeType: contentType, buffer: bytes },
      },
    });
    return response.status();
  }

  /** Full three-step upload: intent -> PUT bytes to storage -> complete. Returns the final file. */
  async uploadPdf(dataRoomId: string, name: string, bytes: Buffer, folderId?: string) {
    const intent = must(
      await this.uploadIntent({ dataRoomId, folderId, name, size: bytes.length, mimeType: 'application/pdf' }),
    );
    const putStatus = await this.putToStorage(intent.uploadUrl, bytes);
    if (putStatus >= 300) throw new Error(`Storage PUT failed: HTTP ${putStatus}`);
    const done = must(await this.completeUpload(intent.fileId));
    return { id: done.id, name: done.name };
  }

  /** Fetches a signed URL (view or download) and returns status, headers and bytes. */
  async fetchSigned(url: string) {
    const response = await this.http.fetch(url);
    return { status: response.status(), headers: response.headers(), body: await response.body() };
  }

  // --- shares
  share(body: { resourceType: ResourceType; resourceId: string; mode: ShareMode; granteeEmail?: string }) {
    return this.call<Share>('POST', '/shares', body);
  }
  listShares(resourceType: ResourceType, resourceId: string) {
    return this.call<Page<Share>>('GET', `/shares?resourceType=${resourceType}&resourceId=${resourceId}`);
  }
  receivedShares() {
    return this.call<Page<ReceivedShare>>('GET', '/shares/received');
  }
  revokeShare(id: string) {
    return this.call<void>('DELETE', `/shares/${id}`);
  }

  // --- public links (anonymous)
  publicShare(token: string) {
    return this.call<{ resourceType: ResourceType; resourceId: string; resourceName: string }>(
      'GET',
      `/public/${token}`,
    );
  }
  publicRootContents(token: string) {
    return this.call<Page<ContentItem>>('GET', `/public/${token}/contents`);
  }
  publicFolderContents(token: string, folderId: string) {
    return this.call<Page<ContentItem>>('GET', `/public/${token}/folders/${folderId}/contents`);
  }
  publicFile(token: string, fileId: string) {
    return this.call<FileDetail>('GET', `/public/${token}/files/${fileId}`);
  }
  publicViewUrl(token: string, fileId: string) {
    return this.call<{ url: string }>('GET', `/public/${token}/files/${fileId}/view-url`);
  }

  /** Walks every page of a cursor-paginated listing. */
  async collectAll<T>(fetchPage: (query: string) => Promise<Res<Page<T>>>, limit = 100): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = must(await fetchPage(query));
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return all;
  }
}
