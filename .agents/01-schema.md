# **Portal Zero \- AI Developer Prompt**

**Role:** You are an expert Firebase and Frontend Developer.

**Context:** We are building "Portal Zero," a centralized school portal. Your task is to implement the core Firebase architecture, Role-Based Access Control (RBAC), and the "Class Sets" management feature for teachers.

**Stack:** Firebase (Auth, Firestore) and modern Javascript/Frontend framework.

Please build the application based strictly on the following specifications:

## **1\. Database Schema (Firestore)**

Use the following collection structures. **CRITICAL:** When creating/updating documents in these collections (except for sets), you must use setDoc with { merge: true } to enforce specific Document IDs. Do NOT use addDoc unless generating a random ID for a Set.

* **Collection: admin\_users**  
  * Document ID: Admin's email address.  
  * email: String  
* **Collection: teachers (System-Controlled Data)**  
  * Document ID: Teacher's email address.  
  * email: String  
  * fullName: String, firstName: String, lastName: String  
  * division: String (Must be: "Secondary", "Primary", or "Administration")  
  * department: Array of Strings  
  * additionalRoles: Array of Strings  
  * portalTeacherCode: String  
  * homeroom: String  
  * gender: String  
* **Collection: TeacherProfile (User-Controlled Data)**  
  * Document ID: Teacher's email address (Must match teachers collection).  
  * displayName: String  
  * preferences: Map/Object  
  * bio: String  
* **Collection: students**  
  * Document ID: Student's email address (Format is always ps\[studentID\]@student.vsa.edu.hk).  
  * studentID: String (**Write a helper function extractStudentID(email) to automatically strip "ps" and "@student.vsa.edu.hk" and save this value**).  
  * email: String  
  * displayName: String, firstName: String, lastName: String, preferredName: String, chineseName: String  
  * gender: String, homeroom: String, house: String, yearGroup: String  
  * managebacID: String  
  * dateOfBirth: Firestore Timestamp  
* **Collection: sets (Teacher Class Groups)**  
  * Document ID: Custom generated string formatted as \[teacherEmail\]\_\[randomUID\].  
  * name: String  
  * owner: String (Teacher's email who created it)  
  * active: Boolean (Default: true)  
  * dateCreated: Firestore Timestamp  
  * tags: Array of Strings (e.g., \["Grade 10", "Math"\])  
  * members: Array of Strings (Storing the Document IDs / emails of the students).

## **2\. Authentication & Onboarding Flow**

Implement Google Authentication and a global state variable systemRole ('Admin', 'Teacher', 'GuestTeacher', 'Student', 'Unauthorized').

**The Login Router Logic (onAuthStateChanged):**

When a user logs in with an @vsa.edu.hk domain, execute the following:

1. **Admin Check:** Query admin\_users. If found, set isAdmin \= true.  
2. **System Data Check:** Query teachers by email.  
   * **If teachers doc EXISTS:** Set systemRole \= isAdmin ? 'Admin' : 'Teacher'.  
   * **If teachers doc DOES NOT EXIST:** Set systemRole \= isAdmin ? 'Admin' : 'GuestTeacher'.  
3. **Profile Hydration & Auto-Generation:** Query TeacherProfile.  
   * If it **exists**: Merge data into app state, route to Main Dashboard.  
   * If it **does NOT exist**:  
     * Auto-generate it using setDoc.  
     * If they are a standard Teacher, set displayName by concatenating firstName \+ lastName from their teachers doc.  
     * If they are a GuestTeacher, set displayName to the part of their email before the @.  
     * Route user to /edit-profile.

## **3\. Core Features to Build**

**A. /edit-profile Page**

* Reusable UI component for onboarding and standard settings.  
* Pulls TeacherProfile data, allows user to edit displayName, and saves back to the TeacherProfile collection.

**B. "Class Sets" Management (CRUD)**

* createSet(): Form to create a set. Enforces the \[teacherEmail\]\_\[randomUID\] ID convention.  
* getSetsByOwner(): Fetch/display sets for the logged-in user. Include a toggle for active: false (archived) sets.  
* updateSet(): Edit name, tags, or toggle active status.

**C. Set Member Population**

* **Hydration:** Create getSetMembers() to fetch a Set, read the members array, and query the students collection to display rich student data in a table.  
* **Manual Entry:** UI to search existing students and add their email to the Set's members array.  
* **Excel/CSV Upload:** Implement a file parser (e.g., PapaParse). Extract student emails/IDs from the sheet and add them to the members array.

## **4\. Firestore Security Rules**

Implement the following firestore.rules exactly:

rules\_version \= '2';  
service cloud.firestore {  
  match /databases/{database}/documents {  
      
    function isAdmin() {  
      return request.auth \!= null &&   
             exists(/databases/$(database)/documents/admin\_users/$(request.auth.token.email));  
    }

    match /admin\_users/{adminEmail} {  
      allow read: if request.auth \!= null;  
      allow write: if isAdmin();  
    }

    match /teachers/{teacherEmail} {  
      allow read: if request.auth \!= null;  
      allow write: if isAdmin();  
    }  
      
    match /TeacherProfile/{teacherEmail} {  
      allow read: if request.auth \!= null;  
      allow write: if isAdmin() || (request.auth \!= null && request.auth.token.email \== teacherEmail);  
    }

    match /students/{studentEmail} {  
      allow read: if request.auth \!= null;  
      allow write: if isAdmin() || (request.auth \!= null && request.auth.token.email.matches('.\*@vsa\\\\.edu\\\\.hk$'));  
    }

    match /sets/{setId} {  
      allow read, write: if request.auth \!= null && (isAdmin() || request.auth.token.email \== resource.data.owner || request.auth.token.email \== request.resource.data.owner);  
    }  
      
    match /{document=\*\*} {  
      allow read, write: if false;  
    }  
  }  
}  