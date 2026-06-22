import { useEffect, useState } from 'react';
import { getDriveToken } from './driveApi';

const loadScript = (url) => {
  return new Promise((resolve, reject) => {
    let script = document.querySelector(`script[src="${url}"]`);
    
    // If the script is already there, we still need to wait for gapi to be ready
    if (script) {
      const checkGapi = setInterval(() => {
        if (window.gapi) {
          clearInterval(checkGapi);
          resolve();
        }
      }, 100);
      return;
    }

    script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.body.appendChild(script);
  });
};

export const useDrivePicker = () => {
  const [pickerApiLoaded, setPickerApiLoaded] = useState(false);

  useEffect(() => {
    loadScript('https://apis.google.com/js/api.js').then(() => {
      window.gapi.load('picker', { callback: () => setPickerApiLoaded(true) });
    });
  }, []);

  const openPicker = ({ type = 'folder', onSelect }) => {
    if (!pickerApiLoaded || !window.google || !window.google.picker) {
      alert('Google Picker API is not fully loaded yet. Please wait a moment and try again.');
      return;
    }

    const token = getDriveToken();
    if (!token) {
      alert('Google Drive access token missing. Please log out and log back in.');
      return;
    }

    const apiKey = "AIzaSyDyPikK4D7pJyo3np-HafYH9LmOkv1kp2E";

    // Configure the view based on type
    let view;
    if (type === 'folder') {
      view = new window.google.picker.DocsView(window.google.picker.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMimeTypes('application/vnd.google-apps.folder');
    } else {
      view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false);
    }

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const doc = data.docs[0];
          onSelect({ id: doc.id, name: doc.name, url: doc.url });
        }
      })
      .build();
      
    picker.setVisible(true);
  };

  return { openPicker, isReady: pickerApiLoaded };
};
