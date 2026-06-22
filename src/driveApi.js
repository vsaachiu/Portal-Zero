const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3/files';

export const getDriveToken = () => {
  return localStorage.getItem('googleDriveAccessToken');
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

export const addPermission = async (fileId, emailAddress, role, token) => {
  // role: 'owner', 'writer', 'commenter', 'reader'
  const body = {
    type: 'user',
    role: role,
    emailAddress: emailAddress,
  };

  const response = await fetch(`${DRIVE_API_URL}/${fileId}/permissions?transferOwnership=${role === 'owner'}`, {
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

  const response = await fetch(`${DRIVE_API_URL}/${fileId}/copy`, {
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
