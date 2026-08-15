const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';
const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

export const getDriveToken = () => {
  return localStorage.getItem('googleDriveAccessToken');
};

export const parseGoogleFileId = (input) => {
  if (!input) return '';
  const trimmed = input.trim();

  const pathMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (pathMatch) return pathMatch[1];

  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch) return queryMatch[1];

  return trimmed;
};

export const downloadCsvFile = (rows, fileName = 'export.csv') => {
  const escapeCell = (value) => {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const csv = rows.map((row) => row.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const createSpreadsheet = async (title, firstSheetTitle, token) => {
  const response = await fetch(SHEETS_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        {
          properties: {
            title: firstSheetTitle,
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to create spreadsheet');
  }

  const data = await response.json();
  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl,
  };
};

export const getSpreadsheetSheetTitles = async (spreadsheetId, token) => {
  const response = await fetch(`${SHEETS_API_URL}/${spreadsheetId}?fields=sheets(properties(title))`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch spreadsheet metadata');
  }

  const data = await response.json();
  return (data.sheets || []).map((sheet) => sheet.properties?.title).filter(Boolean);
};

export const addSheetToSpreadsheet = async (spreadsheetId, sheetTitle, token) => {
  const response = await fetch(`${SHEETS_API_URL}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: sheetTitle,
            },
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to add sheet tab');
  }

  return await response.json();
};

export const writeSheetValues = async (spreadsheetId, sheetTitle, rows, token) => {
  const range = `${sheetTitle}!A1`;
  const response = await fetch(
    `${SHEETS_API_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        majorDimension: 'ROWS',
        values: rows,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to write sheet values');
  }

  return await response.json();
};

export const createFolder = async (name, parentId, token) => {
  const metadata = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentId ? [parentId] : undefined,
  };

  const response = await fetch(DRIVE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to create folder');
  }

  return await response.json(); // returns { id, name, ... }
};

export const addPermission = async (fileId, emailAddress, role, token, sendNotificationEmail = false) => {
  // role: 'owner', 'writer', 'commenter', 'reader'
  const body = {
    type: 'user',
    role: role,
    emailAddress: emailAddress,
  };

  // Drive API requires notification emails for ownership transfer.
  const shouldNotify = role === 'owner' ? true : sendNotificationEmail;

  const params = new URLSearchParams({
    transferOwnership: String(role === 'owner'),
    sendNotificationEmail: String(shouldNotify),
  });

  const response = await fetch(`${DRIVE_API_URL}/${fileId}/permissions?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to add permission');
  }

  return await response.json();
};

export const copyFile = async (fileId, parentId, name, token) => {
  const metadata = {
    name,
    parents: parentId ? [parentId] : undefined,
  };

  const response = await fetch(`${DRIVE_API_URL}/${fileId}/copy?fields=id,name,mimeType,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to copy file');
  }

  return await response.json();
};

export const getFileMetadata = async (fileId, token) => {
  const response = await fetch(`${DRIVE_API_URL}/${fileId}?fields=id,name,mimeType,webViewLink`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to fetch file metadata');
  }

  return await response.json();
};

export const getFileRevisionSummary = async (fileId, token) => {
  let pageToken;
  let revisionCount = 0;
  let latestRevision = null;

  do {
    const params = new URLSearchParams({
      pageSize: '200',
      fields: 'nextPageToken,revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress))',
    });

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await fetch(`${DRIVE_API_URL}/${fileId}/revisions?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to fetch file revisions');
    }

    const data = await response.json();
    const revisions = data.revisions || [];
    revisionCount += revisions.length;

    for (const revision of revisions) {
      if (!latestRevision || new Date(revision.modifiedTime) > new Date(latestRevision.modifiedTime)) {
        latestRevision = revision;
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return {
    revisionCount,
    lastEditedAt: latestRevision?.modifiedTime || null,
    lastEditedBy: latestRevision?.lastModifyingUser?.displayName || null,
    lastEditedByEmail: latestRevision?.lastModifyingUser?.emailAddress || null,
  };
};
