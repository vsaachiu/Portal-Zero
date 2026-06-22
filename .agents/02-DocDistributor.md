# **Portal Zero Feature Development: "Doc Distributor" Module**

## **Context & Goal**

You are an expert React and Firebase developer. We are building a new module called "Doc Distributor" for our school's internal portal, "Portal Zero" (React \+ Vite, Firebase Auth/Firestore).

This module replaces an old Google Sheets App Script. It allows teachers to map a Portal Zero Class Group (set) to one or more Google Drive "Folder Systems", automatically generate subfolders for each student, and distribute copies of Google Doc templates to those specific folder systems with targeted Drive permissions.

## **1\. Pre-requisites & Auth Updates**

1. **Google Drive Scopes:** Update our Firebase Google Sign-In provider configuration to request Google Drive scopes (e.g., https://www.googleapis.com/auth/drive). We will need the user's Google Access Token to perform client-side REST API calls to Google Drive to create folders and copy files.  
2. **Students Collection Update:** Assume the existing students collection now includes a parentEmail (String).

## **2\. Database Schema (Firestore)**

Please implement the following NoSQL schema. All collections for this module are prefixed with dd\_.

*Architectural Note: A single class roster (set) can have multiple distinct folder structures (dd\_folder\_systems) associated with it.*

**Collection: dd\_folder\_systems** (Represents a structured set of Google Drive folders for a specific group)

* systemId: String (Auto-generated Document ID)  
* setId: String (Foreign key to sets collection \- the student roster)  
* systemName: String (e.g., "Y10 Math Core \- Central", "Y10 Math \- Homework Checks")  
* teacherEmail: String (Owner/Creator)  
* isCentral: Boolean (If true, this was provisioned centrally by the school; if false, it's a custom teacher-created system)  
* rootFolderId: String (Google Drive ID of the master folder)  
* rootFolderUrl: String  
* folderPrefix: String (e.g., "DES08")  
* folderSuffix: String (e.g., "2026")  
* shareWithParents: Boolean  
* createdAt: Timestamp

**Collection: dd\_student\_folders** (The actual Google Drive folders mapping to students)

* systemId: String (Foreign key to dd\_folder\_systems)  
* setId: String (Included for easier querying)  
* studentEmail: String (Foreign key)  
* folderId: String (Google Drive ID of the student's subfolder within this specific system)  
* folderUrl: String

**Collection: dd\_distributions** (Tracks a distribution event)

* distributionId: String (Auto-generated Document ID)  
* systemId: String (The target folder system where files were sent)  
* setId: String (Foreign key to sets collection \- duplicated here for efficient cross-system class queries)  
* teacherEmail: String  
* templateFileId: String  
* templateName: String  
* distributionName: String (The title prefix/suffix applied to the distributed copies)  
* permissionType: String ("inherit\_folder", "viewer", "commenter")  
* createdAt: Timestamp

**Collection: dd\_distributed\_files** (The individual files generated)

* distributionId: String (Foreign key linking to dd\_distributions.distributionId)  
* studentEmail: String  
* fileId: String (Drive ID of the new copied file)  
* fileUrl: String  
* status: String ("success", "error")

## **3\. UI/UX & Application Flow**

Please build the React components to facilitate the following flow. *Crucial pattern: Component design for modals/wizards should accept initial states (e.g., initialSelectedStudents) to allow for targeted single-student actions.*

### **View 1: Module Dashboard (Tabs: "Folder Systems" | "Distributions")**

* **Folder Systems Tab:** Displays a list of dd\_folder\_systems accessible to the teacherEmail (either they own it, or it's an isCentral system tied to a set they teach).  
* **Distributions Tab:** A history of templates sent out by this teacher across all their systems.  
* **Buttons:** "Create Folder System" and "Distribute Template".

### **View 2: Create Folder System Wizard**

* **Step 1:** Select a Class Roster (Dropdown of sets owned by the teacher where active \== true).  
* **Step 2:** System Name (e.g., "Vocabulary Folders").  
* **Step 3:** Select Root Google Drive Folder. Implement Google Drive Picker API.  
* **Step 4:** Configure Subfolders. Inputs for Prefix and Suffix. Checkbox for "Share folders with parents (Read-Only)".  
* **Step 5: Student Selection:** Display a list/grid of all students in the selected set. Default all to *Checked*. Allow the teacher to deselect specific students.  
* **Step 6:** Execute. Call the Google Drive API to create a folder for *only the selected students*.  
  * *Naming Convention:* \[Prefix\] \[Student displayName\] \[Suffix\]  
  * *Permissions:* Teacher (Owner), Student (Editor), Parents (Viewer \- if checked).  
  * Save results to dd\_folder\_systems and dd\_student\_folders. Show a progress bar.

### **View 3: Folder System Details & Management**

When a Folder System is clicked from the Dashboard:

* Show system metadata (Root folder link, isCentral status).  
* **Student Roster Table:** Compares the base sets roster against existing dd\_student\_folders for this systemId.  
  * If a folder exists, show the link.  
  * **Missing Folder Indicator:** If a student in the set does *not* have a corresponding record in dd\_student\_folders, highlight this row (e.g., with a warning icon).  
  * **Quick Action:** Provide a "Create Folder" button on the missing student's row. This should trigger the Create Folder System logic (or a streamlined modal) bypassing the setup steps, with *only* that specific student selected to receive the missing folder.  
* **"Bulk Sync New Students" Button:** Optionally, a button to run the above logic for *all* students missing folders simultaneously.

### **View 4: Distribute Template Modal**

* **Step 1:** Select Template (via Google Drive Picker).  
* **Step 2:** Select Target Folder System (Dropdown of their available dd\_folder\_systems).  
* **Step 3:** Configuration.  
  * Naming format: \[Prefix\] \[Student displayName\] \[Suffix\]  
  * Permission Dropdown: 1\. Inherit Folder Permissions (default), 2\. Student is Viewer only, 3\. Student is Commenter only.  
* **Step 4: Student Selection:** Fetch the students from the set. Default all to *Checked*. Allow teacher to deselect specific students. *(Note: Prevent selection or show a warning if a student doesn't have a destination folder in this system).*  
* **Step 5:** Execute. Iterate through dd\_student\_folders for the *selected* students only. Use Google Drive API to copy the template into each student's folder. Apply specific permissions if necessary. Log to dd\_distributions and dd\_distributed\_files.

### **View 5: Distribution Details**

When a specific Distribution is clicked from the Dashboard's "Distributions" tab:

* Show distribution metadata (Template linked, Target System, Permissions).  
* **Student Table:** Compare the students in the associated set against dd\_distributed\_files for this distributionId.  
  * If the file exists, show status (success/error) and link.  
  * **Missing File Indicator:** If a student is missing from the distribution (or had an error), highlight the row.  
  * **Quick Action:** Provide a "Distribute to Student" button. This should open the Distribute Template Modal, pre-filled with the exact same template and configuration, but with *only* the missing student checked in Step 4\.

## **4\. Technical Constraints & Guidelines**

* Use standard REST fetches to https://www.googleapis.com/drive/v3/... using the OAuth token retrieved from Firebase Auth (GoogleAuthProvider.credentialFromResult(result).accessToken).  
* Ensure all Drive API calls are wrapped in try/catch blocks. If one student fails during batch processing, the loop must continue for the others, logging "error" to the database so the UI can offer a retry option later.  
* Stick to Tailwind CSS for styling to match the existing Portal Zero aesthetics.