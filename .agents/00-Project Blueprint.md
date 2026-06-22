# Project Blueprint: Portal Zero

## 1. Project Overview & Tech Stack
Portal Zero is a centralized internal portal for Victoria Shanghai Academy (VSA). The platform provides productivity, class management, and activity tools tailored for school staff, teachers, and students.
*   **Frontend:** React (SPA) + Vite
*   **Backend & Infrastructure:** Firebase Suite
    *   **Authentication:** Google Sign-In (Restricted to school domains)
    *   **Database:** Cloud Firestore (NoSQL)
    *   **Hosting:** Firebase Hosting (Production build targeting the `/dist` directory)
*   **Firebase Project ID:** `vsa-portal-zero-p0` (Web App ID: `1:311864812480:web:7760d44c4a2c740f2d1e25` as seen in `Screenshot 2026-06-21 at 6.36.48 pm.png`)

---

## 2. Authentication & System-Wide Roles
Authentication handles logins from the Google provider. Upon successful login, the application evaluates the user's email domain to determine their global `systemRole`.

### Role Definitions
*   **Admin:** Explicitly declared in the `admin_users` collection. Has global write privileges.
*   **Teacher:** Authenticated via `@vsa.edu.hk` and found in the centralized `teachers` system data collection.
*   **GuestTeacher:** Authenticated via `@vsa.edu.hk` but *not yet provisioned* in the central `teachers` collection. Granted temporary baseline teacher access.
*   **Student:** Authenticated via `@student.vsa.edu.hk`.
*   **Unauthorized:** Any domain outside VSA. Access is strictly blocked.

### Onboarding Flow (First Login)
*   When a `Teacher` or `GuestTeacher` logs in for the first time, a script automatically provisions a document for them in the `TeacherProfile` collection.
*   For registered teachers, `displayName` defaults to `firstName` + `lastName`. For guest teachers, it defaults to their email prefix.
*   Users without a profile are automatically routed to a shared `/edit-profile` workspace to personalize their configuration.

---

## 3. Database Schema (Firestore)

### Collection: `admin_users`
*   *Document ID:* User email address (e.g., `admin@vsa.edu.hk`)
*   `email`: String

### Collection: `teachers` (Centralized System of Record — Admin Edited Only)
*   *Document ID:* Teacher email address (e.g., `teacher@vsa.edu.hk`)
*   `email`: String
*   `fullName`: String
*   `firstName`: String
*   `lastName`: String
*   `division`: String (`"Secondary"`, `"Primary"`, or `"Administration"`)
*   `department`: Array of Strings
*   `additionalRoles`: Array of Strings
*   `portalTeacherCode`: String (Integrates with internal VSA timetabling)
*   `homeroom`: String (Optional)
*   `gender`: String

### Collection: `TeacherProfile` (User Workspace Preferences)
*   *Document ID:* Teacher email address (Matches `teachers` ID)
*   `displayName`: String (User-editable name displayed across the UI)
*   `bio`: String
*   `preferences`: Map/Object (e.g., `{ theme: 'light', notifications: true }`)

### Collection: `students`
*   *Document ID:* Student email address (e.g., `ps12345@student.vsa.edu.hk`)
*   `studentID`: String (Automatically parsed from email: drops "ps" and domain)
*   `email`: String
*   `displayName`: String
*   `firstName`: String
*   `lastName`: String
*   `preferredName`: String
*   `gender`: String
*   `homeroom`: String
*   `chineseName`: String
*   `dateOfBirth`: Timestamp
*   `house`: String
*   `managebacID`: String
*   `yearGroup`: String

### Collection: `sets` (Class Groups)
*   *Document ID:* Custom formatted string `[teacherEmail]_[randomUID]`
*   `name`: String
*   `owner`: String (Creator's teacher email)
*   `active`: Boolean (Defaults to `true`; `false` denotes archived status)
*   `dateCreated`: Timestamp
*   `tags`: Array of Strings (e.g., `["Grade 10", "Math", "HL"]`)
*   `members`: Array of Strings (List of student email strings acting as foreign keys referencing the `students` collection)

### Collection: `dd_folder_systems` (Doc Distributor: Google Drive Folders)
*   *Document ID:* `systemId` (Auto-generated)
*   `setId`: String (Foreign key to `sets`)
*   `systemName`: String
*   `teacherEmail`: String (Owner/Creator)
*   `isCentral`: Boolean
*   `rootFolderId`: String (Google Drive ID)
*   `rootFolderUrl`: String
*   `folderPrefix`: String
*   `folderSuffix`: String
*   `shareWithParents`: Boolean
*   `createdAt`: Timestamp

### Collection: `dd_student_folders` (Doc Distributor: Student Folders)
*   *Document ID:* Auto-generated
*   `systemId`: String (Foreign key to `dd_folder_systems`)
*   `setId`: String
*   `studentEmail`: String (Foreign key)
*   `folderId`: String (Google Drive ID)
*   `folderUrl`: String

### Collection: `dd_distributions` (Doc Distributor: Distribution Events)
*   *Document ID:* `distributionId` (Auto-generated)
*   `systemId`: String (Target folder system)
*   `setId`: String (Foreign key to `sets`)
*   `teacherEmail`: String
*   `templateFileId`: String
*   `templateName`: String
*   `distributionName`: String
*   `permissionType`: String (`"inherit_folder"`, `"viewer"`, `"commenter"`)
*   `createdAt`: Timestamp

### Collection: `dd_distributed_files` (Doc Distributor: Copied Files)
*   *Document ID:* Auto-generated
*   `distributionId`: String (Foreign key to `dd_distributions`)
*   `studentEmail`: String
*   `fileId`: String (Drive ID)
*   `fileUrl`: String
*   `status`: String (`"success"`, `"error"`)

---

## 4. Security Rules Configuration (`firestore.rules`)
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    function isAdmin() {
      return request.auth != null && 
             exists(/databases/$(database)/documents/admin_users/$(request.auth.token.email));
    }

    match /admin_users/{adminEmail} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }

    match /teachers/{teacherEmail} {
      allow read: if request.auth != null;
      allow write: if isAdmin();
    }
    
    match /TeacherProfile/{teacherEmail} {
      allow read: if request.auth != null;
      allow write: if isAdmin() || (request.auth != null && request.auth.token.email == teacherEmail);
    }
    
    match /{document=**} {
      allow read, write: if false;
    }
    
    // Doc Distributor Module Rules
    match /dd_folder_systems/{systemId} {
      allow read, write: if request.auth != null && (isAdmin() || request.auth.token.email == resource.data.teacherEmail || request.auth.token.email == request.resource.data.teacherEmail);
    }
    match /dd_student_folders/{folderId} {
      allow read, write: if request.auth != null && isAdmin(); // Should be updated based on systemId owner
    }
    match /dd_distributions/{distributionId} {
      allow read, write: if request.auth != null && (isAdmin() || request.auth.token.email == resource.data.teacherEmail || request.auth.token.email == request.resource.data.teacherEmail);
    }
    match /dd_distributed_files/{fileId} {
      allow read, write: if request.auth != null; // Refined rules needed
    }
  }
}