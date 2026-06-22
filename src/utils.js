export function extractStudentID(email) {
  if (!email) return '';
  const match = email.match(/^ps(\d+)@student\.vsa\.edu\.hk$/);
  if (match && match[1]) {
    return match[1];
  }
  return '';
}
