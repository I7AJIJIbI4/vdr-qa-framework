export type ResourceType = 'DATAROOM' | 'FOLDER' | 'FILE';
export type ShareMode = 'PUBLIC_LINK' | 'USER';
export type AccessLevel = 'OWNER' | 'VIEWER';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface DataRoom {
  id: string;
  name: string;
  createdAt: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  dataRoomId: string;
}

export interface FileDetail {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  folderId: string | null;
  dataRoomId: string;
}

export type ContentItem =
  | { type: 'folder'; id: string; name: string; parentId: string | null }
  | { type: 'file'; id: string; name: string; folderId: string | null; size: number; mimeType: string };

export interface UploadIntent {
  fileId: string;
  name: string;
  uploadUrl: string;
}

export interface Share {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  mode: ShareMode;
  token: string | null;
  granteeEmail: string | null;
}

export interface ReceivedShare {
  shareId: string;
  resourceType: ResourceType;
  resourceId: string;
  resourceName: string;
  dataRoomId: string;
}

export interface Breadcrumbs {
  dataRoomId: string;
  dataRoomName: string | null;
  folders: { id: string; name: string }[];
  accessLevel: AccessLevel;
}
